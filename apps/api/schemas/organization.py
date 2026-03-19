from pydantic import BaseModel
import uuid
from datetime import datetime
from ..models.organization import OrgRole

class OrgCreate(BaseModel):
    name: str
    slug: str

class OrgResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    logo_url: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

class OrgMemberResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    user_id: uuid.UUID
    role: OrgRole
    joined_at: datetime | None
    model_config = {"from_attributes": True}

class AddOrgMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: OrgRole = OrgRole.member
