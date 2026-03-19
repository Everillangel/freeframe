from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.asset import Asset
from ..models.project import ProjectMember
from ..models.share import AssetShare
from ..models.activity import Mention, Notification
from ..models.comment import Comment
from ..schemas.asset import AssetResponse, NotificationResponse
from ..routers.assets import _build_asset_response, _build_asset_responses_bulk

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/assets", response_model=list[AssetResponse])
def list_my_assets(
    filter: Optional[str] = Query(default=None, description="owned|shared|mentioned|assigned|due_soon"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if filter == "owned":
        assets = db.query(Asset).filter(
            Asset.created_by == current_user.id,
            Asset.deleted_at.is_(None),
        ).all()

    elif filter == "shared":
        shared_ids = db.query(AssetShare.asset_id).filter(
            AssetShare.shared_with_user_id == current_user.id,
            AssetShare.deleted_at.is_(None),
        ).subquery()
        assets = db.query(Asset).filter(
            Asset.id.in_(shared_ids),
            Asset.deleted_at.is_(None),
        ).all()

    elif filter == "mentioned":
        mentioned_asset_ids = (
            db.query(Asset.id)
            .join(Comment, Comment.asset_id == Asset.id)
            .join(Mention, Mention.comment_id == Comment.id)
            .filter(
                Mention.mentioned_user_id == current_user.id,
                Asset.deleted_at.is_(None),
                Comment.deleted_at.is_(None),
            )
            .distinct()
            .all()
        )
        ids = [r[0] for r in mentioned_asset_ids]
        assets = db.query(Asset).filter(Asset.id.in_(ids), Asset.deleted_at.is_(None)).all()

    elif filter == "assigned":
        assets = db.query(Asset).filter(
            Asset.assignee_id == current_user.id,
            Asset.deleted_at.is_(None),
        ).all()

    elif filter == "due_soon":
        now = datetime.now(timezone.utc)
        assets = db.query(Asset).filter(
            Asset.assignee_id == current_user.id,
            Asset.due_date.isnot(None),
            Asset.due_date <= now + timedelta(days=7),
            Asset.deleted_at.is_(None),
        ).all()

    else:
        # All accessible: member of project OR directly shared OR assigned
        project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == current_user.id,
            ProjectMember.deleted_at.is_(None),
        ).subquery()
        shared_ids = db.query(AssetShare.asset_id).filter(
            AssetShare.shared_with_user_id == current_user.id,
            AssetShare.deleted_at.is_(None),
        ).subquery()
        assets = db.query(Asset).filter(
            Asset.deleted_at.is_(None),
        ).filter(
            or_(
                Asset.project_id.in_(project_ids),
                Asset.id.in_(shared_ids),
                Asset.assignee_id == current_user.id,
            )
        ).all()

    return _build_asset_responses_bulk(assets, db)


@router.get("/notifications", response_model=list[NotificationResponse])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notifications = db.query(Notification).filter(
        Notification.user_id == current_user.id,
    ).order_by(Notification.created_at.desc()).limit(50).all()
    return notifications


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    db.commit()
    return {"status": "ok"}


@router.patch("/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read.is_(False),
    ).update({"read": True})
    db.commit()
    return {"status": "ok"}
