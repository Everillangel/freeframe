from pydantic import BaseModel
import uuid
from datetime import datetime
from ..models.project import ProjectType, ProjectRole

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    project_type: ProjectType = ProjectType.personal
    team_id: uuid.UUID | None = None
    org_id: uuid.UUID

class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class ProjectResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    team_id: uuid.UUID | None
    name: str
    description: str | None
    project_type: ProjectType
    created_by: uuid.UUID
    created_at: datetime
    model_config = {"from_attributes": True}

class ProjectMemberResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    role: ProjectRole
    model_config = {"from_attributes": True}

class AddProjectMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole = ProjectRole.viewer

class UpdateProjectMemberRequest(BaseModel):
    role: ProjectRole
