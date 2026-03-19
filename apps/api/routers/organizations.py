from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timezone
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.organization import Organization, OrgMember, OrgRole
from ..schemas.organization import OrgCreate, OrgResponse, OrgMemberResponse, AddOrgMemberRequest

router = APIRouter(prefix="/organizations", tags=["organizations"])

def _get_org(db: Session, org_id: uuid.UUID) -> Organization:
    org = db.query(Organization).filter(Organization.id == org_id, Organization.deleted_at.is_(None)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org

def _require_org_admin(db: Session, org_id: uuid.UUID, user: User) -> OrgMember:
    member = db.query(OrgMember).filter(
        OrgMember.org_id == org_id,
        OrgMember.user_id == user.id,
        OrgMember.deleted_at.is_(None),
    ).first()
    if not member or member.role not in (OrgRole.owner, OrgRole.admin):
        raise HTTPException(status_code=403, detail="Org admin access required")
    return member

@router.post("", response_model=OrgResponse, status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    return _get_org(db, org_id)

@router.post("/{org_id}/members", response_model=OrgMemberResponse, status_code=status.HTTP_201_CREATED)
def add_org_member(org_id: uuid.UUID, body: AddOrgMemberRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_org(db, org_id)
    _require_org_admin(db, org_id, current_user)
    existing = db.query(OrgMember).filter(OrgMember.org_id == org_id, OrgMember.user_id == body.user_id, OrgMember.deleted_at.is_(None)).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already a member")
    member = OrgMember(org_id=org_id, user_id=body.user_id, role=body.role, joined_at=datetime.now(timezone.utc))
    db.add(member)
    db.commit()
    db.refresh(member)
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
