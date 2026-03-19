from celery import Celery
from ..config import settings

celery_app = Celery(
    "freeframe",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["apps.api.tasks.transcode_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "apps.api.tasks.transcode_tasks.*": {"queue": "transcoding"},
    },
)
