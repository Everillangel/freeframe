from pydantic import BaseModel
import uuid
from datetime import datetime
from typing import Optional
from ..models.share import SharePermission

class ShareLinkCreate(BaseModel):
    permission: SharePermission = SharePermission.view
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    allow_download: bool = False

class ShareLinkResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    token: str
    permission: SharePermission
    allow_download: bool
    expires_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}

class ShareLinkValidateResponse(BaseModel):
    asset_id: uuid.UUID
    permission: SharePermission
    allow_download: bool
    requires_password: bool

class DirectShareCreate(BaseModel):
    permission: SharePermission = SharePermission.view
    user_id: Optional[uuid.UUID] = None
    team_id: Optional[uuid.UUID] = None

class DirectShareResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    shared_with_user_id: Optional[uuid.UUID]
    shared_with_team_id: Optional[uuid.UUID]
    permission: SharePermission
    created_at: datetime
    model_config = {"from_attributes": True}
