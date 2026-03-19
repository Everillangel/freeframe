from fastapi import HTTPException
from sqlalchemy.orm import Session
import uuid
from ..models.user import User
from ..models.organization import OrgMember, OrgRole

def require_org_admin(db: Session, org_id: uuid.UUID, user: User) -> OrgMember:
    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user.id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member or member.role not in (OrgRole.owner, OrgRole.admin):
        raise HTTPException(status_code=403, detail="Org admin access required")
    return member
