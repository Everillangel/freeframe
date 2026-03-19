from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid
from datetime import datetime, timezone
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.organization import Organization, OrgMember, OrgRole
from ..models.activity import ActivityLog
from ..models.project import Project, ProjectMember, ProjectRole
from ..schemas.organization import OrgCreate, OrgResponse, OrgMemberResponse, AddOrgMemberRequest, OrgListResponse
from ..schemas.activity import ActivityLogResponse
from ..services.permissions import require_org_admin
from ..tasks.email_tasks import send_invite_email
from ..config import settings

router = APIRouter(prefix="/organizations", tags=["organizations"])

def _get_org(db: Session, org_id: uuid.UUID) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id, Organization.deleted_at.is_(None)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org

def _require_org_admin(db: Session, org_id: uuid.UUID, user: User) -> OrgMember:
    return require_org_admin(db, org_id, user)

@router.get("", response_model=list[OrgListResponse])
def list_orgs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all organizations. Super admins see all; regular users see only their orgs."""
    if current_user.is_superadmin:
        orgs = db.query(Organization).filter(Organization.deleted_at.is_(None)).order_by(Organization.created_at.desc()).all()
    else:
        org_ids = (
            db.query(OrgMember.org_id)
            .filter(OrgMember.user_id == current_user.id, OrgMember.deleted_at.is_(None))
            .subquery()
        )
        orgs = db.query(Organization).filter(
            Organization.id.in_(org_ids),
            Organization.deleted_at.is_(None),
        ).order_by(Organization.created_at.desc()).all()

    result = []
    for org in orgs:
        member_count = db.query(func.count(OrgMember.id)).filter(
            OrgMember.org_id == org.id, OrgMember.deleted_at.is_(None)
        ).scalar() or 0
        project_count = db.query(func.count(Project.id)).filter(
            Project.org_id == org.id, Project.deleted_at.is_(None)
        ).scalar() or 0
        result.append(OrgListResponse(
            id=org.id, name=org.name, slug=org.slug,
            logo_url=org.logo_url, created_at=org.created_at,
            member_count=member_count, project_count=project_count,
        ))
    return result


@router.post("", response_model=OrgResponse, status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Only super admins can create organizations
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Only super admins can create organizations")
    
    if db.query(Organization).filter(Organization.slug == body.slug, Organization.deleted_at.is_(None)).first():
        raise HTTPException(status_code=400, detail="Slug already taken")
    org = Organization(name=body.name, slug=body.slug)
    db.add(org)
    db.flush()
    member = OrgMember(org_id=org.id, user_id=current_user.id, role=OrgRole.owner, joined_at=datetime.now(timezone.utc))
    db.add(member)
    db.commit()
    db.refresh(org)
    return org

@router.get("/{org_id}", response_model=OrgResponse)
def get_org(org_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    org = _get_org(db, org_id)
    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == current_user.id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not an org member")
    return org

@router.post("/{org_id}/members", response_model=OrgMemberResponse, status_code=status.HTTP_201_CREATED)
def add_org_member(org_id: uuid.UUID, body: AddOrgMemberRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_org(db, org_id)
    _require_org_admin(db, org_id, current_user)
    # Check including soft-deleted
    existing = db.query(OrgMember).filter(OrgMember.org_id == org_id, OrgMember.user_id == body.user_id).first()
    if existing:
        if existing.deleted_at is None:
            raise HTTPException(status_code=400, detail="User already a member")
        # Reactivate soft-deleted membership
        existing.deleted_at = None
        existing.role = body.role
        existing.joined_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        return existing
    member = OrgMember(org_id=org_id, user_id=body.user_id, role=body.role, joined_at=datetime.now(timezone.utc))
    db.add(member)
    db.commit()
    db.refresh(member)
    
    # Send invite email
    org = _get_org(db, org_id)
    invited_user = db.query(User).filter(User.id == body.user_id).first()
    if invited_user:
        invite_link = f"{settings.frontend_url}/organizations/{org_id}"
        send_invite_email.delay(
            to_email=invited_user.email,
            inviter_name=current_user.name,
            org_name=org.name,
            invite_link=invite_link,
        )
    
    return member

@router.delete("/{org_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_org_member(org_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_org(db, org_id)
    _require_org_admin(db, org_id, current_user)
    member = db.query(OrgMember).filter(OrgMember.org_id == org_id, OrgMember.user_id == user_id, OrgMember.deleted_at.is_(None)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/{org_id}/activity", response_model=list[ActivityLogResponse])
def get_org_activity(
    org_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List activity log entries for an org. Requires org admin or owner."""
    _get_org(db, org_id)
    _require_org_admin(db, org_id, current_user)
    entries = (
        db.query(ActivityLog)
        .filter(ActivityLog.org_id == org_id)
        .order_by(ActivityLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return entries


# ── Project activity (placed here to avoid circular router imports) ────────────

_project_activity_router = APIRouter(prefix="/projects", tags=["projects"])


@_project_activity_router.get("/{project_id}/activity", response_model=list[ActivityLogResponse])
def get_project_activity(
    project_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List activity log entries for a project. Requires project viewer or higher."""
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == current_user.id,
        ProjectMember.deleted_at.is_(None),
    ).first()
    if not member:
        # Org admin also has access
        org_member = db.query(OrgMember).filter(
            OrgMember.org_id == project.org_id,
            OrgMember.user_id == current_user.id,
            OrgMember.deleted_at.is_(None),
        ).first()
        if not org_member or org_member.role not in (OrgRole.owner, OrgRole.admin):
            raise HTTPException(status_code=403, detail="Project access required")
    entries = (
        db.query(ActivityLog)
        .filter(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return entries
