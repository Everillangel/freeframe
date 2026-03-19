from fastapi import HTTPException, status
from sqlalchemy.orm import Session
import uuid
from ..models.user import User
from ..models.organization import OrgMember, OrgRole
from ..models.team import TeamMember
from ..models.project import Project, ProjectMember, ProjectRole
from ..models.asset import Asset
from ..models.share import AssetShare, ShareLink, SharePermission


# ── Org-level ─────────────────────────────────────────────────────────────────

def require_org_admin(db: Session, org_id: uuid.UUID, user: User) -> OrgMember:
    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user.id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member or member.role not in (OrgRole.owner, OrgRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org admin access required")
    return member


def get_org_member(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> OrgMember | None:
    return db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user_id,
        OrgMember.deleted_at.is_(None),
    ).first()


# ── Project-level ──────────────────────────────────────────────────────────────

def get_project_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
        ProjectMember.deleted_at.is_(None),
    ).first()


def require_project_role(
    db: Session,
    project_id: uuid.UUID,
    user: User,
    minimum_role: ProjectRole,
) -> ProjectMember:
    """Require the user to have at least `minimum_role` on the project.

    Role hierarchy (descending): owner > editor > reviewer > viewer
    """
    ROLE_RANK = {
        ProjectRole.owner: 4,
        ProjectRole.editor: 3,
        ProjectRole.reviewer: 2,
        ProjectRole.viewer: 1,
    }
    member = get_project_member(db, project_id, user.id)
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")
    if ROLE_RANK[member.role] < ROLE_RANK[minimum_role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires {minimum_role.value} role or higher",
        )
    return member


# ── Asset-level ────────────────────────────────────────────────────────────────

def can_access_asset(db: Session, asset: Asset, user: User) -> bool:
    """Check if user can access the asset via any path."""
    # 1. Asset creator
    if asset.created_by == user.id:
        return True

    # 2. Project member
    if get_project_member(db, asset.project_id, user.id):
        return True

    # 3. Direct AssetShare with user
    direct = db.query(AssetShare).filter(
        AssetShare.asset_id == asset.id,
        AssetShare.shared_with_user_id == user.id,
        AssetShare.deleted_at.is_(None),
    ).first()
    if direct:
        return True

    # 4. AssetShare with user's team
    user_team_ids = db.query(TeamMember.team_id).filter(
        TeamMember.user_id == user.id,
        TeamMember.deleted_at.is_(None),
    ).subquery()
    team_share = db.query(AssetShare).filter(
        AssetShare.asset_id == asset.id,
        AssetShare.shared_with_team_id.in_(user_team_ids),
        AssetShare.deleted_at.is_(None),
    ).first()
    if team_share:
        return True

    # 5. Org admin
    project = db.query(Project).filter(Project.id == asset.project_id).first()
    if project and get_org_member(db, project.org_id, user.id):
        org_member = get_org_member(db, project.org_id, user.id)
        if org_member and org_member.role in (OrgRole.owner, OrgRole.admin):
            return True

    return False


def require_asset_access(db: Session, asset: Asset, user: User) -> None:
    if not can_access_asset(db, asset, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def get_asset_share_permission(db: Session, asset: Asset, user: User) -> SharePermission:
    """Get the effective share permission for a user on an asset (highest wins)."""
    PERM_RANK = {
        SharePermission.approve: 3,
        SharePermission.comment: 2,
        SharePermission.view: 1,
    }

    best = SharePermission.view

    # Direct share
    direct = db.query(AssetShare).filter(
        AssetShare.asset_id == asset.id,
        AssetShare.shared_with_user_id == user.id,
        AssetShare.deleted_at.is_(None),
    ).first()
    if direct and PERM_RANK[direct.permission] > PERM_RANK[best]:
        best = direct.permission

    # Team shares
    user_team_ids = db.query(TeamMember.team_id).filter(
        TeamMember.user_id == user.id,
        TeamMember.deleted_at.is_(None),
    ).subquery()
    team_shares = db.query(AssetShare).filter(
        AssetShare.asset_id == asset.id,
        AssetShare.shared_with_team_id.in_(user_team_ids),
        AssetShare.deleted_at.is_(None),
    ).all()
    for ts in team_shares:
        if PERM_RANK[ts.permission] > PERM_RANK[best]:
            best = ts.permission

    return best


# ── Share link validation ──────────────────────────────────────────────────────

def validate_share_link(db: Session, token: str) -> ShareLink:
    """Validate a share link token and return the link. Raises 404/410 on failure."""
    from datetime import datetime, timezone
    link = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.deleted_at.is_(None),
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link has expired")
    return link
