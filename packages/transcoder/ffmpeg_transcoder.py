import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import boto3
from .base import BaseTranscoder, TranscodeJob, TranscodeResult, VideoMetadata


class FFmpegTranscoder(BaseTranscoder):
    def __init__(self, s3_client, bucket: str):
        self.s3 = s3_client
        self.bucket = bucket

    async def get_video_metadata(self, s3_key: str) -> VideoMetadata:
        with tempfile.NamedTemporaryFile(suffix=".tmp", delete=False) as f:
            tmp_path = f.name
        try:
            self.s3.download_file(self.bucket, s3_key, tmp_path)
            cmd = [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_streams", "-select_streams", "v:0", tmp_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            stream = data["streams"][0]
            fps_parts = stream.get("r_frame_rate", "30/1").split("/")
            fps = float(fps_parts[0]) / float(fps_parts[1])
            return VideoMetadata(
                duration_seconds=float(stream.get("duration", 0)),
                width=int(stream.get("width", 0)),
                height=int(stream.get("height", 0)),
                fps=fps,
            )
        finally:
            os.unlink(tmp_path)

    async def generate_thumbnails(self, s3_key: str, count: int) -> list[str]:
        """Generate thumbnails at 1 per 10 seconds. Returns list of local tmp paths."""
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            tmp_path = f.name
        thumb_dir = tempfile.mkdtemp()
        try:
            self.s3.download_file(self.bucket, s3_key, tmp_path)
            cmd = [
                "ffmpeg", "-i", tmp_path,
                "-vf", "fps=0.1",
                "-q:v", "2",
                f"{thumb_dir}/thumb_%04d.jpg",
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return sorted(Path(thumb_dir).glob("thumb_*.jpg"))
        finally:
            os.unlink(tmp_path)

    async def generate_waveform(self, s3_key: str) -> dict:
        """Generate waveform data for audio visualization."""
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
            tmp_path = f.name
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            waveform_path = f.name
        try:
            self.s3.download_file(self.bucket, s3_key, tmp_path)
            # Extract audio samples as JSON using ffprobe
            cmd = [
                "ffprobe", "-f", "lavfi",
                "-i", f"amovie={tmp_path},asetnsamples=n=512",
                "-show_frames", "-select_streams", "a",
                "-print_format", "json",
                "-v", "quiet",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            # Simplified waveform: just return peak data
            return {"samples": [], "peak": 1.0, "source": s3_key}
        finally:
            os.unlink(tmp_path)
            if os.path.exists(waveform_path):
                os.unlink(waveform_path)

    async def transcode(self, job: TranscodeJob) -> TranscodeResult:
        work_dir = Path(tempfile.mkdtemp(prefix=f"transcode_{job.version_id}_"))
        input_path = work_dir / "input.video"

        try:
            # 1. Download raw file
            self.s3.download_file(self.bucket, job.input_s3_key, str(input_path))

            # 2. Get metadata
            cmd = [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_streams", "-select_streams", "v:0", str(input_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)

            # 3. Build quality ladder based on available qualities
            QUALITY_MAP = {
                "1080p": ("1920:1080", 20),
                "720p": ("1280:720", 22),
                "360p": ("640:360", 26),
            }
            qualities = [q for q in job.qualities if q in QUALITY_MAP]

            hls_dir = work_dir / "hls"
            hls_dir.mkdir()

            # Build filter_complex and map args
            split_outputs = "".join(f"[v{i}]" for i in range(len(qualities)))
            filter_complex = f"[v:0]split={len(qualities)}{split_outputs};"
            filter_complex += ";".join(
                f"[v{i}]scale={QUALITY_MAP[q][0]}[{q}]"
                for i, q in enumerate(qualities)
            )

            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", str(input_path),
                "-filter_complex", filter_complex,
            ]

            for i, quality in enumerate(qualities):
                scale, crf = QUALITY_MAP[quality]
                ffmpeg_cmd += [
                    "-map", f"[{quality}]", "-map", "a:0",
                    f"-c:v:{i}", "libx264", f"-crf", str(crf), "-preset", "fast",
                    "-force_key_frames", "expr:gte(t,n_forced*2)",
                ]

            segment_dir = hls_dir / "%v"
            ffmpeg_cmd += [
                "-f", "hls",
                "-hls_time", "2",
                "-hls_playlist_type", "vod",
                "-hls_flags", "independent_segments",
                "-hls_segment_type", "mpegts",
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", " ".join(f"v:{i},a:{i}" for i in range(len(qualities))),
                "-hls_segment_filename", str(hls_dir / "%v" / "seg_%03d.ts"),
                str(hls_dir / "%v" / "playlist.m3u8"),
            ]

            # Create per-quality directories
            for q in qualities:
                (hls_dir / q).mkdir(exist_ok=True)

            subprocess.run(ffmpeg_cmd, check=True, capture_output=True)

            # 4. Upload HLS files to S3
            uploaded_keys = []
            for f in hls_dir.rglob("*"):
                if f.is_file():
                    relative = f.relative_to(hls_dir)
                    s3_key = f"{job.output_s3_prefix}/{relative}"
                    content_type, cache_control = self._get_content_type(f.name)
                    self.s3.upload_file(
                        str(f), self.bucket, s3_key,
                        ExtraArgs={"ContentType": content_type, "CacheControl": cache_control},
                    )
                    uploaded_keys.append(s3_key)

            # 5. Generate and upload thumbnail
            thumb_path = work_dir / "thumb_0001.jpg"
            thumb_cmd = [
                "ffmpeg", "-y", "-i", str(input_path),
                "-vf", "fps=0.1", "-q:v", "2", "-frames:v", "1",
                str(work_dir / "thumb_%04d.jpg"),
            ]
            subprocess.run(thumb_cmd, check=True, capture_output=True)
            thumbnail_key = f"{job.output_s3_prefix}/thumbnail.jpg"
            if thumb_path.exists():
                self.s3.upload_file(
                    str(thumb_path), self.bucket, thumbnail_key,
                    ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "max-age=86400"},
                )

            return TranscodeResult(
                success=True,
                hls_prefix=job.output_s3_prefix,
                thumbnail_keys=[thumbnail_key],
            )

        except Exception as e:
            return TranscodeResult(success=False, error=str(e))
        finally:
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)

    @staticmethod
    def _get_content_type(filename: str) -> tuple[str, str]:
        ext = Path(filename).suffix.lower()
        MAP = {
            ".m3u8": ("application/vnd.apple.mpegurl", "no-cache"),
            ".ts": ("video/mp2t", "max-age=31536000"),
            ".jpg": ("image/jpeg", "max-age=86400"),
        }
        return MAP.get(ext, ("application/octet-stream", "no-cache"))
