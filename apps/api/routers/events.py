from fastapi import APIRouter, Query, HTTPException, Request, status
from fastapi.responses import StreamingResponse
import uuid
from typing import Optional
from ..database import SessionLocal
from ..services.auth_service import decode_token, get_user_by_id
from ..models.user import UserStatus
from ..services.event_service import event_stream
from ..services.permissions import get_project_member, is_public_project

router = APIRouter(prefix="/events", tags=["events"])

@router.get("/{project_id}")
async def stream_events(
    project_id: uuid.UUID,
    request: Request,
    token: Optional[str] = Query(None),
):
    # Authorize with a SHORT-LIVED DB session that is CLOSED BEFORE the stream
    # starts. Do NOT use Depends(get_db) here: FastAPI runs a yield-dependency's
    # cleanup only after the response body finishes, and an SSE body never
    # finishes until the client disconnects — so the pooled connection would be
    # pinned for the whole life of the stream. A few open review tabs then
    # exhaust the pool (default 15) and every other request blocks for
    # pool_timeout (30s) and 500s. The stream itself (event_stream) is Redis-only
    # and needs no DB connection.
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]

    db = SessionLocal()
    try:
        user = None
        if token:
            payload = decode_token(token)
            if payload and payload.get("type") == "access":
                try:
                    user = get_user_by_id(db, uuid.UUID(payload["sub"]))
                except (ValueError, KeyError, TypeError):
                    user = None
        if not user or user.status == UserStatus.deactivated:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")
        # Verify user has access to this project
        if not get_project_member(db, project_id, user.id) and not is_public_project(db, project_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")
    finally:
        db.close()

    return StreamingResponse(
        event_stream(str(project_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
