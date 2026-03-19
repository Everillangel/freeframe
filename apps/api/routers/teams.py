from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timezone
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.organization import OrgMember, OrgRole
from ..models.team import Team, TeamMember, TeamRole
from ..schemas.team import TeamCreate, TeamResponse, TeamMemberResponse, AddTeamMemberRequest

router = APIRouter(tags=["teams"])

def _require_org_admin(db: Session, org_id: uuid.UUID, user: User):
    member = db.query(OrgMember).filter(OrgMember.org_id == org_id, OrgMember.user_id == user.id, OrgMember.deleted_at.is_(None)).first()
    if not member or member.role not in (OrgRole.owner, OrgRole.admin):
        raise HTTPException(status_code=403, detail="Org admin access required")

@router.post("/organizations/{org_id}/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def create_team(org_id: uuid.UUID, body: TeamCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_org_admin(db, org_id, current_user)
    team = Team(org_id=org_id, name=body.name, description=body.description)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team

@router.get("/organizations/{org_id}/teams", response_model=list[TeamResponse])
def list_teams(org_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Team).filter(Team.org_id == org_id, Team.deleted_at.is_(None)).all()

@router.post("/teams/{team_id}/members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED)
def add_team_member(team_id: uuid.UUID, body: AddTeamMemberRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = db.query(Team).filter(Team.id == team_id, Team.deleted_at.is_(None)).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    _require_org_admin(db, team.org_id, current_user)
    existing = db.query(TeamMember).filter(TeamMember.team_id == team_id, TeamMember.user_id == body.user_id, TeamMember.deleted_at.is_(None)).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already a team member")
    member = TeamMember(team_id=team_id, user_id=body.user_id, role=body.role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member

@router.delete("/teams/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_member(team_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = db.query(Team).filter(Team.id == team_id, Team.deleted_at.is_(None)).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    _require_org_admin(db, team.org_id, current_user)
    member = db.query(TeamMember).filter(TeamMember.team_id == team_id, TeamMember.user_id == user_id, TeamMember.deleted_at.is_(None)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.deleted_at = datetime.now(timezone.utc)
    db.commit()
