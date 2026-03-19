from pydantic import BaseModel
import uuid
from datetime import datetime
from typing import Optional

class AnnotationData(BaseModel):
    drawing_data: dict  # Fabric.js canvas JSON
    frame_number: Optional[int] = None
    carousel_position: Optional[int] = None

class CommentCreate(BaseModel):
    version_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    timecode_start: Optional[float] = None
    timecode_end: Optional[float] = None
    body: str
    annotation: Optional[AnnotationData] = None

class GuestCommentCreate(BaseModel):
    version_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    timecode_start: Optional[float] = None
    timecode_end: Optional[float] = None
    body: str
    annotation: Optional[AnnotationData] = None
    guest_email: str
    guest_name: str

class CommentUpdate(BaseModel):
    body: str

class AnnotationResponse(BaseModel):
    id: uuid.UUID
    comment_id: uuid.UUID
    drawing_data: dict
    frame_number: Optional[int]
    carousel_position: Optional[int]
    model_config = {"from_attributes": True}

class CommentResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    version_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    author_id: Optional[uuid.UUID]
    guest_author_id: Optional[uuid.UUID]
    timecode_start: Optional[float]
    timecode_end: Optional[float]
    body: str
    resolved: bool
    created_at: datetime
    updated_at: datetime
    annotation: Optional[AnnotationResponse] = None
    replies: list["CommentResponse"] = []
    model_config = {"from_attributes": True}

CommentResponse.model_rebuild()
