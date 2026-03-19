from pydantic import BaseModel, field_validator
import uuid
import re
from datetime import datetime
from ..models.organization import OrgRole

class OrgCreate(BaseModel):
    name: str
    slug: str

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        if not re.match(r'^[a-z0-9-]+$', v):
            raise ValueError("Slug must contain only lowercase letters, numbers, and hyphens")
        if len(v) < 2 or len(v) > 63:
            raise ValueError("Slug must be 2-63 characters")
        return v

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
