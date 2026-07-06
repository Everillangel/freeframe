"""Scheduled data-retention enforcement (POPIA s14 — retention limitation).

Runs daily via Celery beat:

- Anonymises registered users that were soft-deleted more than
  ``retention_erase_after_days`` ago and whose personal data has not already
  been erased. This is the safety net behind the immediate erasure endpoint:
  even a plain ``DELETE /users/{id}`` (soft delete) eventually strips PII.
- Purges share-link activity logs older than ``retention_activity_days``. These
  are append-only audit rows with no inbound foreign keys, so deletion is safe.
"""

from datetime import datetime, timezone, timedelta

from .celery_app import celery_app
from ..database import SessionLocal
from ..config import settings
from ..models.user import User
from ..models.share import ShareLinkActivity
from ..services import privacy_service


@celery_app.task(name="purge_expired_data")
def purge_expired_data():
    """Anonymise long-soft-deleted users and purge stale activity logs."""
    db = SessionLocal()
    anonymised = 0
    purged_activity = 0
    try:
        now = datetime.now(timezone.utc)

        erase_cutoff = now - timedelta(days=settings.retention_erase_after_days)
        stale_users = db.query(User).filter(
            User.deleted_at.isnot(None),
            User.deleted_at < erase_cutoff,
        ).all()
        for user in stale_users:
            if not privacy_service.is_erased(user.email):
                privacy_service.erase_user(db, user)  # commits internally
                anonymised += 1

        activity_cutoff = now - timedelta(days=settings.retention_activity_days)
        purged_activity = db.query(ShareLinkActivity).filter(
            ShareLinkActivity.created_at < activity_cutoff,
        ).delete(synchronize_session=False)
        db.commit()

        return {"users_anonymised": anonymised, "activity_purged": purged_activity}
    finally:
        db.close()
