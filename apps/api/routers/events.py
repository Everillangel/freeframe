from fastapi import APIRouter, Depends, Query, HTTPException, Request, status
from fastapi.responses import StreamingResponse
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from ..database import get_db
from ..middleware.auth import get_current_user, get_optional_user
from ..services.auth_service import decode_token, get_user_by_id
from ..models.user import User, UserStatus
from ..services.event_service import event_stream
from ..services.permissions import get_project_member, is_public_project

router = APIRouter(prefix="/events", tags=["events"])

@router.get("/{project_id}")
async def stream_events(
    project_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # EventSource can't send Authorization headers, so accept token as query param
    user = current_user
    if not user and token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            user = get_user_by_id(db, uuid.UUID(payload["sub"]))
    if not user or user.status == UserStatus.deactivated:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")

    # Verify user has access to this project
    if not get_project_member(db, project_id, user.id) and not is_public_project(db, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")

    return StreamingResponse(
        event_stream(str(project_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
