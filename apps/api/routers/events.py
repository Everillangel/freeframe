from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
import uuid
from ..middleware.auth import get_current_user
from ..models.user import User
from ..services.event_service import event_stream

router = APIRouter(prefix="/events", tags=["events"])

@router.get("/{project_id}")
async def stream_events(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    return StreamingResponse(
        event_stream(str(project_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
