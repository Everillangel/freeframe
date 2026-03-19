from typing import Optional
from fastapi import Header, HTTPException, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.share import ShareLink
from ..services.permissions import validate_share_link


def get_share_link(
    x_share_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[ShareLink]:
    """Optional share link dependency — returns None if no token provided."""
    if not x_share_token:
        return None
    return validate_share_link(db, x_share_token)


def require_share_link(
    x_share_token: str = Header(),
    db: Session = Depends(get_db),
) -> ShareLink:
    """Required share link dependency — raises 401 if no token."""
    return validate_share_link(db, x_share_token)
