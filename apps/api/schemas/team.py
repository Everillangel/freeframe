from pydantic import BaseModel
import uuid
from datetime import datetime
from ..models.team import TeamRole

class TeamCreate(BaseModel):
    name: str
    description: str | None = None

class TeamResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

class TeamMemberResponse(BaseModel):
    id: uuid.UUID
    team_id: uuid.UUID
    user_id: uuid.UUID
    role: TeamRole
    model_config = {"from_attributes": True}

class AddTeamMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: TeamRole = TeamRole.member
