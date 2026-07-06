"""POPIA data-subject endpoints.

- Self-service data export for the authenticated user (access request).
- Superadmin-driven export and erasure for any user or guest, so a responsible
  party can action access/erasure requests — including for guest reviewers who
  have no login of their own.
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User, GuestUser
from ..services import privacy_service

router = APIRouter(tags=["privacy"])


def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin required")
    return current_user


def _json_download(payload: dict, filename: str) -> Response:
    return Response(
        content=json.dumps(payload, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Self-service ────────────────────────────────────────────────────────────

@router.get("/me/data-export")
def export_my_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download all personal data held about the authenticated user (POPIA s23)."""
    data = privacy_service.export_user_data(db, current_user)
    return _json_download(data, f"freeframe-data-{current_user.id}.json")


# ── Admin: users ────────────────────────────────────────────────────────────

@router.get("/admin/privacy/users/{user_id}/data-export")
def admin_export_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _json_download(privacy_service.export_user_data(db, user), f"freeframe-data-{user.id}.json")


@router.post("/admin/privacy/users/{user_id}/erase")
def admin_erase_user(
    user_id: uuid.UUID,
    purge_media: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """Irreversibly anonymise a user's personal data (POPIA s24 / erasure)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return privacy_service.erase_user(db, user, purge_media=purge_media)


# ── Admin: guests ───────────────────────────────────────────────────────────

@router.get("/admin/privacy/guests/{guest_id}/data-export")
def admin_export_guest(
    guest_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    guest = db.query(GuestUser).filter(GuestUser.id == guest_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return _json_download(privacy_service.export_guest_data(db, guest), f"freeframe-guest-data-{guest.id}.json")


@router.post("/admin/privacy/guests/{guest_id}/erase")
def admin_erase_guest(
    guest_id: uuid.UUID,
    purge_media: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    guest = db.query(GuestUser).filter(GuestUser.id == guest_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return privacy_service.erase_guest(db, guest, purge_media=purge_media)
