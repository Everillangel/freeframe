"""Org admin dashboard endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User, UserStatus
from ..models.organization import Organization, OrgMember, OrgRole
from ..models.project import Project, ProjectMember
from ..models.asset import Asset, AssetVersion, MediaFile
from ..models.activity import ActivityLog
from ..schemas.activity import ActivityLogResponse
from ..services.permissions import require_org_admin

router = APIRouter(tags=["admin"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class OrgDashboardResponse(BaseModel):
    member_count: int
    project_count: int
    asset_count: int
    storage_used_bytes: int
    recent_activity: list[ActivityLogResponse]

    model_config = {"from_attributes": True}


class OrgMemberAdminResponse(BaseModel):
    user_id: uuid.UUID
    name: Optional[str]
    email: str
    role: OrgRole
    joined_at: Optional[datetime]

    model_config = {"from_attributes": True}


class UpdateMemberRoleRequest(BaseModel):
    role: OrgRole


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: Optional[str]
    avatar_url: Optional[str] = None
    status: str
    is_superadmin: bool = False
    email_verified: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AdminUsersListResponse(BaseModel):
    items: list[AdminUserResponse]
    total: int


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_org(db: Session, org_id: uuid.UUID) -> Organization:
    org = db.query(Organization).filter(
        Organization.id == org_id,
        Organization.deleted_at.is_(None),
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _require_org_owner(db: Session, org_id: uuid.UUID, user: User) -> OrgMember:
    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user.id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member or member.role != OrgRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org owner access required")
    return member


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/admin/users", response_model=AdminUsersListResponse)
def list_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all platform users. Requires super admin."""
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")

    users = (
        db.query(User)
        .filter(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .all()
    )

    items = [
        AdminUserResponse(
            id=u.id,
            email=u.email,
            name=u.name,
            avatar_url=u.avatar_url,
            status=u.status.value if isinstance(u.status, UserStatus) else str(u.status),
            is_superadmin=u.is_superadmin,
            email_verified=u.email_verified,
            created_at=u.created_at,
        )
        for u in users
    ]

    return AdminUsersListResponse(items=items, total=len(items))


@router.get("/organizations/{org_id}/admin/dashboard", response_model=OrgDashboardResponse)
def org_admin_dashboard(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return aggregate org stats. Requires org admin or owner."""
    _get_org(db, org_id)
    require_org_admin(db, org_id, current_user)

    member_count = db.query(func.count(OrgMember.id)).filter(
        OrgMember.org_id == org_id,
        OrgMember.deleted_at.is_(None),
    ).scalar() or 0

    # Active projects in org
    project_ids_subquery = (
        db.query(Project.id)
        .filter(Project.org_id == org_id, Project.deleted_at.is_(None))
        .subquery()
    )

    project_count = db.query(func.count(Project.id)).filter(
        Project.org_id == org_id,
        Project.deleted_at.is_(None),
    ).scalar() or 0

    # Active assets across all org projects
    asset_count = db.query(func.count(Asset.id)).filter(
        Asset.project_id.in_(project_ids_subquery),
        Asset.deleted_at.is_(None),
    ).scalar() or 0

    # Storage: sum of MediaFile.file_size_bytes for all versions of all assets in org
    asset_ids_subquery = (
        db.query(Asset.id)
        .filter(Asset.project_id.in_(project_ids_subquery), Asset.deleted_at.is_(None))
        .subquery()
    )
    version_ids_subquery = (
        db.query(AssetVersion.id)
        .filter(
            AssetVersion.asset_id.in_(asset_ids_subquery),
            AssetVersion.deleted_at.is_(None),
        )
        .subquery()
    )
    storage_used_bytes = db.query(func.coalesce(func.sum(MediaFile.file_size_bytes), 0)).filter(
        MediaFile.version_id.in_(version_ids_subquery),
    ).scalar() or 0

    # Recent 10 activity entries for org
    recent_activity = (
        db.query(ActivityLog)
        .filter(ActivityLog.org_id == org_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(10)
        .all()
    )

    return OrgDashboardResponse(
        member_count=member_count,
        project_count=project_count,
        asset_count=asset_count,
        storage_used_bytes=int(storage_used_bytes),
        recent_activity=recent_activity,
    )


@router.get("/organizations/{org_id}/admin/members", response_model=list[OrgMemberAdminResponse])
def list_org_admin_members(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List org members with user details. Requires org admin or owner."""
    _get_org(db, org_id)
    require_org_admin(db, org_id, current_user)

    rows = (
        db.query(OrgMember, User)
        .join(User, User.id == OrgMember.user_id)
        .filter(
            OrgMember.org_id == org_id,
            OrgMember.deleted_at.is_(None),
        )
        .all()
    )

    result = []
    for membership, user in rows:
        result.append(
            OrgMemberAdminResponse(
                user_id=membership.user_id,
                name=user.name,
                email=user.email,
                role=membership.role,
                joined_at=membership.joined_at,
            )
        )
    return result


@router.patch("/organizations/{org_id}/admin/members/{user_id}/role")
def update_member_role(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UpdateMemberRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a member's org role. Requires org owner only."""
    _get_org(db, org_id)
    _require_org_owner(db, org_id, current_user)

    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user_id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.role = body.role
    db.commit()
    return {"updated": True}


@router.delete("/organizations/{org_id}/admin/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_org_member_admin(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a member from the org. Requires org admin or owner. Cannot remove yourself."""
    _get_org(db, org_id)
    require_org_admin(db, org_id, current_user)

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the org")

    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user_id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Hard delete — membership is not soft-deleted by convention in admin ops
    db.delete(member)
    db.commit()
