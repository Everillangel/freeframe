"""Backfill source media metadata (fps / resolution / duration).

Historically the transcoder probed the source but never persisted the result, so
existing MediaFile rows have NULL fps/width/height/duration. That's not just a
display gap: marker exports convert comment times to frames using fps, and a
missing value falls back to 30 fps — silently shifting every exported timecode
on non-30fps footage.

This re-probes affected rows in place. Safe to re-run: it only touches rows that
are still missing a frame rate.
"""

import subprocess

from .celery_app import celery_app
from ..database import SessionLocal
from ..config import settings
from ..models.asset import MediaFile, FileType


def _probe_url(url: str) -> dict:
    from packages.transcoder.ffmpeg_transcoder import parse_probe
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", "-select_streams", "v:0", url],
        capture_output=True, text=True, timeout=120,
    )
    return parse_probe(out.stdout)


@celery_app.task(name="backfill_media_metadata")
def backfill_media_metadata(limit: int = 500):
    """Re-probe video MediaFiles that are missing a frame rate."""
    from ..services.s3_service import get_s3_client

    db = SessionLocal()
    scanned = 0
    updated = 0
    try:
        s3 = get_s3_client()
        rows = db.query(MediaFile).filter(
            MediaFile.file_type == FileType.video,
            MediaFile.fps.is_(None),
            MediaFile.s3_key_raw.isnot(None),
        ).limit(limit).all()

        for mf in rows:
            scanned += 1
            try:
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": settings.s3_bucket, "Key": mf.s3_key_raw},
                    ExpiresIn=3600,
                )
                meta = _probe_url(url)
                if not meta:
                    continue
                if meta.get("fps"):
                    mf.fps = meta["fps"]
                if meta.get("width"):
                    mf.width = meta["width"]
                if meta.get("height"):
                    mf.height = meta["height"]
                if meta.get("duration_seconds"):
                    mf.duration_seconds = meta["duration_seconds"]
                updated += 1
            except Exception as exc:  # one bad file must not stop the sweep
                print(f"[backfill_media_metadata] skipped {mf.id}: {exc}")
                continue

        db.commit()
        print(f"[backfill_media_metadata] scanned={scanned} updated={updated}")
        return {"scanned": scanned, "updated": updated}
    finally:
        db.close()
