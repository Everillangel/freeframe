import uuid
import sys
import os

# Ensure the workspace root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from .celery_app import celery_app
from ..database import SessionLocal
from ..models.asset import AssetVersion, MediaFile, ProcessingStatus, AssetType
from ..models.asset import Asset
from ..services.s3_service import get_s3_client
from ..config import settings

import asyncio


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_asset(self, asset_id: str, version_id: str):
    """Main processing task dispatched after upload completes."""
    db = SessionLocal()
    try:
        version = db.query(AssetVersion).filter(AssetVersion.id == uuid.UUID(version_id)).first()
        if not version:
            return

        asset = db.query(Asset).filter(Asset.id == uuid.UUID(asset_id)).first()
        if not asset:
            return

        media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
        if not media_file:
            return

        output_prefix = f"processed/{asset.project_id}/{asset_id}/{version_id}"
        s3 = get_s3_client()

        try:
            if asset.asset_type in (AssetType.video,):
                _process_video(db, asset, version, media_file, s3, output_prefix)
            elif asset.asset_type == AssetType.audio:
                _process_audio(db, asset, version, media_file, s3, output_prefix)
            elif asset.asset_type in (AssetType.image, AssetType.image_carousel):
                _process_image(db, asset, version, media_file, s3, output_prefix)

            version.processing_status = ProcessingStatus.ready
            db.commit()

            # Publish SSE event (best-effort)
            _publish_event(str(asset.project_id), "transcode_complete", {
                "asset_id": asset_id,
                "version_id": version_id,
            })

        except Exception as exc:
            version.processing_status = ProcessingStatus.failed
            db.commit()
            _publish_event(str(asset.project_id), "transcode_failed", {
                "asset_id": asset_id,
                "error": str(exc),
            })
            raise self.retry(exc=exc)

    finally:
        db.close()


def _process_video(db, asset, version, media_file, s3, output_prefix):
    from packages.transcoder.ffmpeg_transcoder import FFmpegTranscoder
    from packages.transcoder.base import TranscodeJob

    transcoder = FFmpegTranscoder(s3, settings.s3_bucket)
    job = TranscodeJob(
        media_id=str(asset.id),
        version_id=str(version.id),
        input_s3_key=media_file.s3_key_raw,
        output_s3_prefix=output_prefix,
        qualities=["1080p", "720p", "360p"],
    )
    result = _run_async(transcoder.transcode(job))
    if not result.success:
        raise RuntimeError(f"Transcode failed: {result.error}")

    media_file.s3_key_processed = result.hls_prefix
    if result.thumbnail_keys:
        media_file.s3_key_thumbnail = result.thumbnail_keys[0]
    db.flush()


def _process_audio(db, asset, version, media_file, s3, output_prefix):
    from packages.transcoder.image_processor import process_audio
    result = process_audio(s3, settings.s3_bucket, media_file.s3_key_raw, output_prefix)
    media_file.s3_key_processed = result.get("mp3_key")
    if result.get("waveform_key"):
        media_file.s3_key_thumbnail = result["waveform_key"]
    db.flush()


def _process_image(db, asset, version, media_file, s3, output_prefix):
    from packages.transcoder.image_processor import process_image
    result = process_image(s3, settings.s3_bucket, media_file.s3_key_raw, output_prefix)
    media_file.s3_key_processed = result.get("webp_key")
    media_file.s3_key_thumbnail = result.get("thumbnail_key")
    db.flush()


def _publish_event(project_id: str, event_type: str, payload: dict):
    """Fire-and-forget SSE event publish from Celery worker context."""
    try:
        import asyncio
        loop = asyncio.new_event_loop()
        from apps.api.services.event_service import publish
        loop.run_until_complete(publish(project_id, event_type, payload))
        loop.close()
    except Exception:
        pass  # SSE publish is best-effort
