from pydantic import BaseModel
import uuid
from typing import Literal, Optional

class MetadataFieldCreate(BaseModel):
    name: str
    field_type: Literal["text", "number", "date", "select", "multi_select", "url", "boolean"]
    options: Optional[list[str]] = None  # for select/multi_select
    required: bool = False

class MetadataFieldResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    field_type: str
    options: Optional[list[str]] = None
    required: bool
    model_config = {"from_attributes": True}

class AssetMetadataSet(BaseModel):
    field_id: uuid.UUID
    value: Optional[str] = None

class AssetMetadataResponse(BaseModel):
    field_id: uuid.UUID
    field_name: str
    field_type: str
    value: Optional[str] = None

class CollectionCreate(BaseModel):
    name: str
    filter_rules: Optional[dict] = None
    is_smart: bool = False

class CollectionResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    filter_rules: Optional[dict] = None
    is_smart: bool
    asset_count: int = 0
    model_config = {"from_attributes": True}

class CollectionShareCreate(BaseModel):
    user_id: uuid.UUID
