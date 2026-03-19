import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..middleware.share_auth import get_share_link
from ..models.asset import Asset
from ..models.comment import Annotation, Comment
from ..models.activity import Mention, Notification, NotificationType, ActivityLog, ActivityAction
from ..models.user import User, GuestUser
from ..models.share import ShareLink, SharePermission
from ..schemas.comment import (
    AnnotationResponse,
    CommentCreate,
    CommentResponse,
    CommentUpdate,
    GuestCommentCreate,
)
from ..services.permissions import require_asset_access, validate_share_link

router = APIRouter(tags=["comments"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_asset(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _build_comment_response(comment: Comment, db: Session) -> CommentResponse:
    annotation = db.query(Annotation).filter(Annotation.comment_id == comment.id).first()
    replies_raw = db.query(Comment).filter(
        Comment.parent_id == comment.id,
        Comment.deleted_at.is_(None),
    ).order_by(Comment.created_at).all()

    resp = CommentResponse.model_validate(comment)
    resp.annotation = AnnotationResponse.model_validate(annotation) if annotation else None
    resp.replies = [_build_comment_response(r, db) for r in replies_raw]
    return resp


def _parse_mentions(body: str) -> list[str]:
    """Extract @email mentions from comment body."""
    return re.findall(r"@([\w.+-]+@[\w.-]+\.\w+)", body)


def _create_mentions(db: Session, comment: Comment, asset: Asset, body: str) -> None:
    """Parse @mentions, create Mention + Notification records."""
    from ..services.auth_service import get_user_by_email
    emails = _parse_mentions(body)
    for email in set(emails):
        user = get_user_by_email(db, email)
        if user and user.id != comment.author_id:
            mention = Mention(comment_id=comment.id, mentioned_user_id=user.id)
            db.add(mention)
            notif = Notification(
                user_id=user.id,
                type=NotificationType.mention,
                asset_id=asset.id,
                comment_id=comment.id,
            )
            db.add(notif)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/comments", response_model=list[CommentResponse])
def list_comments(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)
    # Top-level comments only (parent_id is None)
    top_level = db.query(Comment).filter(
        Comment.asset_id == asset_id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
    ).order_by(Comment.created_at).all()
    return [_build_comment_response(c, db) for c in top_level]


@router.post("/assets/{asset_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    asset_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)

    comment = Comment(
        asset_id=asset_id,
        version_id=body.version_id,
        parent_id=body.parent_id,
        author_id=current_user.id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
    )
    db.add(comment)
    db.flush()

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
            carousel_position=body.annotation.carousel_position,
        )
        db.add(annotation)

    _create_mentions(db, comment, asset, body.body)

    # Activity log
    activity = ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.commented)
    db.add(activity)

    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db)


@router.post("/assets/{asset_id}/comments/{comment_id}/replies", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def reply_to_comment(
    asset_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)
    parent = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent comment not found")

    # Force body's version_id to match parent
    reply = Comment(
        asset_id=asset_id,
        version_id=parent.version_id,
        parent_id=comment_id,
        author_id=current_user.id,
        body=body.body,
    )
    db.add(reply)
    db.flush()
    _create_mentions(db, reply, asset, body.body)
    db.commit()
    db.refresh(reply)
    return _build_comment_response(reply, db)


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Can only edit your own comments")
    comment.body = body.body
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Can only delete your own comments")
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/comments/{comment_id}/resolve", response_model=CommentResponse)
def resolve_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    asset = _get_asset(db, comment.asset_id)
    require_asset_access(db, asset, current_user)
    comment.resolved = True
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db)


# ── Guest comments (via share link) ───────────────────────────────────────────

@router.post("/share/{token}/comment", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def guest_comment(
    token: str,
    body: GuestCommentCreate,
    db: Session = Depends(get_db),
):
    link = validate_share_link(db, token)

    # Check share link permission allows commenting
    if link.permission == SharePermission.view:
        raise HTTPException(status_code=403, detail="This share link does not allow commenting")

    asset = _get_asset(db, link.asset_id)

    # Get or create GuestUser by email
    guest = db.query(GuestUser).filter(GuestUser.email == body.guest_email).first()
    if not guest:
        guest = GuestUser(email=body.guest_email, name=body.guest_name)
        db.add(guest)
        db.flush()

    comment = Comment(
        asset_id=asset.id,
        version_id=body.version_id,
        parent_id=body.parent_id,
        guest_author_id=guest.id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
    )
    db.add(comment)
    db.flush()

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
            carousel_position=body.annotation.carousel_position,
        )
        db.add(annotation)

    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db)
