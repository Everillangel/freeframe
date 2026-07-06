"""POPIA data-subject operations: export (access) and erasure.

Two responsibilities:

- ``export_*`` gather everything the system holds about a person into a plain
  JSON-serialisable dict, to satisfy a data-subject access request (POPIA s23).

- ``erase_*`` anonymise a person across every table that stores their identity
  (POPIA s24 / right to deletion). We anonymise rather than hard-delete rows so
  the review history stays referentially intact, while the personal information
  (name, email, credentials, avatar) is irreversibly removed. Denormalised
  copies of the email/name (e.g. in share-link activity logs) are scrubbed too.
  With ``purge_media=True`` the person's uploaded comment attachments are also
  deleted from object storage.

Anonymisation is idempotent: re-running on an already-erased record is a no-op.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models.user import User, UserStatus, GuestUser
from ..models.project import ProjectMember
from ..models.comment import Comment, CommentAttachment
from ..models.activity import Mention, Notification, ActivityLog
from ..models.share import ShareLink, ShareLinkActivity
from ..services import s3_service

ERASED_NAME = "Erased User"
ERASED_DOMAIN = "erased.invalid"


def _erased_email(subject_id: uuid.UUID) -> str:
    return f"erased-{subject_id}@{ERASED_DOMAIN}"


def is_erased(email: str | None) -> bool:
    return bool(email) and email.endswith(f"@{ERASED_DOMAIN}")


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ── Export (subject access) ─────────────────────────────────────────────────

def export_user_data(db: Session, user: User) -> dict:
    """Assemble everything held about a registered user."""
    memberships = db.query(ProjectMember).filter(
        ProjectMember.user_id == user.id,
    ).all()
    comments = db.query(Comment).filter(Comment.author_id == user.id).all()
    mentions = db.query(Mention).filter(Mention.mentioned_user_id == user.id).all()
    notifications = db.query(Notification).filter(Notification.user_id == user.id).all()
    activity = db.query(ActivityLog).filter(ActivityLog.user_id == user.id).all()
    share_links = db.query(ShareLink).filter(ShareLink.created_by == user.id).all()
    share_activity = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.actor_email == user.email,
    ).all()

    return {
        "exported_at": _dt(datetime.now(timezone.utc)),
        "subject_type": "user",
        "profile": {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "status": user.status.value if hasattr(user.status, "value") else user.status,
            "email_verified": user.email_verified,
            "is_superadmin": user.is_superadmin,
            "preferences": user.preferences,
            "created_at": _dt(user.created_at),
        },
        "project_memberships": [
            {"project_id": str(m.project_id), "role": m.role.value if hasattr(m.role, "value") else m.role}
            for m in memberships
        ],
        "comments": [
            {
                "id": str(c.id),
                "asset_id": str(c.asset_id),
                "body": c.body,
                "timecode_start": c.timecode_start,
                "created_at": _dt(c.created_at),
            }
            for c in comments
        ],
        "mentions_received": [{"comment_id": str(m.comment_id), "created_at": _dt(m.created_at)} for m in mentions],
        "notifications": [{"id": str(n.id), "type": n.type.value if hasattr(n.type, "value") else n.type, "created_at": _dt(n.created_at)} for n in notifications],
        "activity": [{"action": a.action, "created_at": _dt(a.created_at)} for a in activity],
        "share_links_created": [{"id": str(s.id), "token": s.token, "created_at": _dt(s.created_at)} for s in share_links],
        "share_link_activity": [
            {"action": a.action.value if hasattr(a.action, "value") else a.action, "asset_name": a.asset_name, "created_at": _dt(a.created_at)}
            for a in share_activity
        ],
    }


def export_guest_data(db: Session, guest: GuestUser) -> dict:
    """Assemble everything held about a guest (share-link) reviewer."""
    comments = db.query(Comment).filter(Comment.guest_author_id == guest.id).all()
    share_activity = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.actor_email == guest.email,
    ).all()
    return {
        "exported_at": _dt(datetime.now(timezone.utc)),
        "subject_type": "guest",
        "profile": {
            "id": str(guest.id),
            "email": guest.email,
            "name": guest.name,
            "created_at": _dt(guest.created_at),
        },
        "comments": [
            {"id": str(c.id), "asset_id": str(c.asset_id), "body": c.body, "created_at": _dt(c.created_at)}
            for c in comments
        ],
        "share_link_activity": [
            {"action": a.action.value if hasattr(a.action, "value") else a.action, "asset_name": a.asset_name, "created_at": _dt(a.created_at)}
            for a in share_activity
        ],
    }


# ── Erasure ─────────────────────────────────────────────────────────────────

def _scrub_share_activity(db: Session, old_email: str) -> int:
    """Anonymise denormalised actor identity in share-link activity logs."""
    rows = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.actor_email == old_email,
    ).all()
    for row in rows:
        row.actor_email = "erased@" + ERASED_DOMAIN
        row.actor_name = ERASED_NAME
    return len(rows)


def _purge_comment_attachments(db: Session, comment_ids: list[uuid.UUID]) -> int:
    if not comment_ids:
        return 0
    attachments = db.query(CommentAttachment).filter(
        CommentAttachment.comment_id.in_(comment_ids),
    ).all()
    count = 0
    for att in attachments:
        try:
            s3_service.delete_object(att.s3_key)
        except Exception:
            pass  # best-effort object deletion
        db.delete(att)
        count += 1
    return count


def erase_user(db: Session, user: User, purge_media: bool = False) -> dict:
    """Irreversibly anonymise a registered user's personal data."""
    if is_erased(user.email):
        return {"status": "already_erased", "user_id": str(user.id)}

    old_email = user.email
    scrubbed_activity = _scrub_share_activity(db, old_email)

    purged_attachments = 0
    if purge_media:
        comment_ids = [c.id for c in db.query(Comment.id).filter(Comment.author_id == user.id).all()]
        purged_attachments = _purge_comment_attachments(db, comment_ids)

    user.email = _erased_email(user.id)
    user.name = ERASED_NAME
    user.avatar_url = None
    user.password_hash = None
    user.preferences = {}
    user.invite_token = None
    user.invite_token_expires_at = None
    user.email_verified = False
    user.status = UserStatus.deactivated
    if user.deleted_at is None:
        user.deleted_at = datetime.now(timezone.utc)

    db.commit()
    return {
        "status": "erased",
        "user_id": str(user.id),
        "share_activity_scrubbed": scrubbed_activity,
        "attachments_purged": purged_attachments,
    }


def erase_guest(db: Session, guest: GuestUser, purge_media: bool = False) -> dict:
    """Irreversibly anonymise a guest reviewer's personal data."""
    if is_erased(guest.email):
        return {"status": "already_erased", "guest_id": str(guest.id)}

    old_email = guest.email
    scrubbed_activity = _scrub_share_activity(db, old_email)

    purged_attachments = 0
    if purge_media:
        comment_ids = [c.id for c in db.query(Comment.id).filter(Comment.guest_author_id == guest.id).all()]
        purged_attachments = _purge_comment_attachments(db, comment_ids)

    guest.email = _erased_email(guest.id)
    guest.name = ERASED_NAME

    db.commit()
    return {
        "status": "erased",
        "guest_id": str(guest.id),
        "share_activity_scrubbed": scrubbed_activity,
        "attachments_purged": purged_attachments,
    }
