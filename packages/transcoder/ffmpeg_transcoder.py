import asyncio
import functools
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import boto3
from botocore.config import Config
from .base import BaseTranscoder, TranscodeJob, TranscodeResult, VideoMetadata


# HLS quality ladder. `crf` drives the software (x264) encoder; hardware encoders
# have no CRF, so they use bitrate/maxrate/bufsize instead.
QUALITY_MAP = {
    "1080p": {"scale": "1920:1080", "crf": 20, "bitrate": "5M",  "maxrate": "6M",    "bufsize": "10M"},
    "720p":  {"scale": "1280:720",  "crf": 22, "bitrate": "3M",  "maxrate": "4M",    "bufsize": "6M"},
    "360p":  {"scale": "640:360",   "crf": 26, "bitrate": "1M",  "maxrate": "1500k", "bufsize": "2M"},
}

# Render node for VAAPI/QSV (override with VAAPI_DEVICE if your GPU is elsewhere).
VAAPI_DEVICE = os.environ.get("VAAPI_DEVICE", "/dev/dri/renderD128")

# Supported hardware-acceleration back-ends (selected via TRANSCODER_HWACCEL).
#   none  -> libx264 (CPU)
#   vaapi -> h264_vaapi  (Intel + AMD/Radeon on Linux, via /dev/dri)
#   qsv   -> h264_qsv    (Intel Quick Sync)
#   nvenc -> h264_nvenc  (NVIDIA / CUDA)
HWACCELS = {"none", "vaapi", "qsv", "nvenc"}


def parse_probe(probe_json: str) -> dict:
    """Extract duration/width/height/fps from `ffprobe -show_streams -show_format` JSON.

    Returns a dict with any values it could determine (missing ones omitted), so a
    weird source never breaks the transcode. Frame rate matters beyond display:
    marker exports convert comment times to frames with it.
    """
    out = {}
    try:
        data = json.loads(probe_json or "{}")
    except (ValueError, TypeError):
        return out

    streams = data.get("streams") or []
    fmt = data.get("format") or {}

    if streams:
        s = streams[0]
        if s.get("width"):
            out["width"] = int(s["width"])
        if s.get("height"):
            out["height"] = int(s["height"])
        rate = s.get("r_frame_rate") or s.get("avg_frame_rate")
        if rate and "/" in str(rate):
            num, den = str(rate).split("/", 1)
            try:
                if float(den) != 0:
                    out["fps"] = float(num) / float(den)
            except ValueError:
                pass
        if s.get("duration"):
            try:
                out["duration_seconds"] = float(s["duration"])
            except ValueError:
                pass

    # Container duration is the reliable fallback (many streams omit it).
    if "duration_seconds" not in out and fmt.get("duration"):
        try:
            out["duration_seconds"] = float(fmt["duration"])
        except ValueError:
            pass
    return out


@functools.lru_cache(maxsize=1)
def _ffmpeg_encoders() -> str:
    """Cached `ffmpeg -encoders` output (probed once per worker process)."""
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=30,
        )
        return out.stdout or ""
    except Exception:
        return ""


@functools.lru_cache(maxsize=1)
def detect_hwaccel() -> str:
    """Probe for a usable hardware H.264 encoder, preferring the fastest.

    Order: NVIDIA (nvenc) → Intel/AMD (vaapi) → Intel (qsv) → none (CPU).
    Requires both the ffmpeg encoder AND a working device, so it returns a
    back-end only when it's genuinely usable; otherwise "none". Cached, so the
    probe runs once per worker process. Logged so the choice is visible.
    """
    encoders = _ffmpeg_encoders()
    chosen = "none"

    # NVIDIA: encoder present + a GPU visible via nvidia-smi
    if "h264_nvenc" in encoders:
        try:
            r = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=10)
            if r.returncode == 0 and r.stdout.strip():
                chosen = "nvenc"
        except Exception:
            pass

    # Intel/AMD VAAPI: encoder + render node + vainfo reports H.264 encode
    if chosen == "none" and "h264_vaapi" in encoders and os.path.exists(VAAPI_DEVICE):
        try:
            r = subprocess.run(["vainfo"], capture_output=True, text=True, timeout=10)
            out = (r.stdout or "") + (r.stderr or "")
            if "H264" in out and "EncSlice" in out:
                chosen = "vaapi"
        except Exception:
            pass

    # Intel QSV: encoder + render node (harder to probe; CPU fallback covers misfires)
    if chosen == "none" and "h264_qsv" in encoders and os.path.exists(VAAPI_DEVICE):
        chosen = "qsv"

    print(f"[transcoder] hardware acceleration auto-detected: {chosen}")
    return chosen


def resolve_hwaccel(hwaccel: str) -> str:
    """Map the configured value to a concrete back-end ('auto' → detected)."""
    mode = (hwaccel or "none").lower()
    if mode == "auto":
        return detect_hwaccel()
    return mode if mode in HWACCELS else "none"


def build_hls_command(input_url: str, hls_dir: Path, qualities: list,
                      hwaccel: str, has_audio: bool = True) -> list:
    """Build the multi-rendition HLS ffmpeg command for the given accelerator.

    Scaling stays on the CPU (cheap); only the encode — the expensive part — is
    offloaded to the GPU. VAAPI needs the frames uploaded to the GPU first
    (`format=nv12,hwupload`); NVENC/QSV accept system-memory frames directly.
    """
    mode = (hwaccel or "none").lower()
    if mode not in HWACCELS:
        mode = "none"

    def branch_filter(i: int, q: str) -> str:
        f = (f"[v{i}]scale={QUALITY_MAP[q]['scale']}:force_original_aspect_ratio=decrease,"
             f"pad=ceil(iw/2)*2:ceil(ih/2)*2")
        if mode == "vaapi":
            # nv12 is 8-bit 4:2:0; hwupload moves frames to the GPU for encode.
            f += ",format=nv12,hwupload"
        else:
            # Browsers only decode 8-bit 4:2:0 H.264. Pro sources are often 10-bit
            # or 4:2:2 (ProRes/log), which libx264 would otherwise preserve as
            # High 10 / High 4:2:2 — segments download fine but the browser can't
            # decode them (hls.js "mediaError"). Force yuv420p so output is playable.
            f += ",format=yuv420p"
        return f + f"[{q}]"

    split_outputs = "".join(f"[v{i}]" for i in range(len(qualities)))
    filter_complex = f"[v:0]split={len(qualities)}{split_outputs};"
    filter_complex += ";".join(branch_filter(i, q) for i, q in enumerate(qualities))

    cmd = ["ffmpeg", "-y"]
    if mode == "vaapi":
        cmd += ["-vaapi_device", VAAPI_DEVICE]
    elif mode == "qsv":
        cmd += ["-init_hw_device", f"qsv=hw:{VAAPI_DEVICE}", "-filter_hw_device", "hw"]
    cmd += ["-i", input_url, "-filter_complex", filter_complex]

    for i, quality in enumerate(qualities):
        m = QUALITY_MAP[quality]
        cmd += ["-map", f"[{quality}]"]
        if has_audio:
            cmd += ["-map", "a:0"]
        if mode == "vaapi":
            cmd += [f"-c:v:{i}", "h264_vaapi", f"-b:v:{i}", m["bitrate"],
                    f"-maxrate:v:{i}", m["maxrate"], f"-bufsize:v:{i}", m["bufsize"]]
        elif mode == "qsv":
            cmd += [f"-c:v:{i}", "h264_qsv", f"-b:v:{i}", m["bitrate"],
                    f"-maxrate:v:{i}", m["maxrate"]]
        elif mode == "nvenc":
            cmd += [f"-c:v:{i}", "h264_nvenc", "-preset", "p5", "-rc", "vbr",
                    f"-b:v:{i}", m["bitrate"], f"-maxrate:v:{i}", m["maxrate"],
                    f"-bufsize:v:{i}", m["bufsize"]]
        else:  # none / CPU
            cmd += [f"-c:v:{i}", "libx264", "-crf", str(m["crf"]), "-preset", "fast"]
        cmd += ["-force_key_frames", "expr:gte(t,n_forced*2)"]

    if has_audio:
        # Re-encode audio to stereo AAC. Source audio is often PCM or multichannel
        # (pro footage), neither of which plays in a browser via HLS/MPEG-TS — a
        # copied codec is another cause of hls.js "mediaError". Downmix to stereo.
        cmd += ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]

    cmd += [
        "-f", "hls",
        "-hls_time", "2",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_type", "mpegts",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", " ".join(
            (f"v:{i},a:{i}" if has_audio else f"v:{i}") for i in range(len(qualities))
        ),
        "-hls_segment_filename", str(hls_dir / "%v" / "seg_%03d.ts"),
        str(hls_dir / "%v" / "playlist.m3u8"),
    ]
    return cmd


def parse_probe_metadata(data: dict) -> Optional[VideoMetadata]:
    """Parse ffprobe JSON (-show_streams -show_format) into VideoMetadata.

    Returns None when there is no video stream. Guards r_frame_rate "0/0"
    (fps stays 0.0 — never fabricate a rate) and falls back to format-level
    duration when the stream lacks one (common for MKV/WebM).
    """
    streams = data.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    fps = 0.0
    raw_rate = stream.get("r_frame_rate") or ""
    if "/" in raw_rate:
        num, _, den = raw_rate.partition("/")
        try:
            if float(den) != 0:
                fps = float(num) / float(den)
        except ValueError:
            fps = 0.0
    duration = float(stream.get("duration") or 0)
    if not duration:
        duration = float((data.get("format") or {}).get("duration") or 0)
    return VideoMetadata(
        duration_seconds=duration,
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        fps=fps,
    )


class FFmpegTranscoder(BaseTranscoder):
    def __init__(self, s3_client, bucket: str, s3_endpoint: str = None, hwaccel: str = "none"):
        self.s3 = s3_client
        self.bucket = bucket
        self.s3_endpoint = s3_endpoint
        self.hwaccel = (hwaccel or "none").lower()
    
    def _get_presigned_url(self, s3_key: str, expires_in: int = 7200) -> str:
        """Generate a presigned URL for streaming input to FFmpeg."""
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": s3_key},
            ExpiresIn=expires_in,
        )

    @staticmethod
    def _run(cmd: list[str], timeout: int | None = None, label: str = "ffmpeg") -> str:
        """Run a command, raising RuntimeError with stderr on failure.

        Uses errors='replace' because ffmpeg often echoes input metadata
        (Latin-1 / Shift-JIS) to stderr, which would break strict UTF-8 decode.
        """
        result = subprocess.run(
            cmd, capture_output=True, text=True, errors='replace', timeout=timeout,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            raise RuntimeError(
                f"{label} exited {result.returncode}: {stderr or 'no stderr output'}"
            )
        return result.stdout

    async def get_video_metadata(self, s3_key: str) -> VideoMetadata:
        """Get video metadata using streaming (no full download)."""
        input_url = self._get_presigned_url(s3_key)
        cmd = [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_streams", "-select_streams", "v:0", "-show_format", input_url,
        ]
        stdout = self._run(cmd, timeout=120, label="ffprobe")
        meta = parse_probe_metadata(json.loads(stdout))
        if meta is None:
            raise RuntimeError(f"No video stream found in {s3_key}")
        return meta

    async def generate_thumbnails(self, s3_key: str, count: int) -> list[str]:
        """Generate thumbnails at 1 per 10 seconds using streaming input."""
        input_url = self._get_presigned_url(s3_key)
        thumb_dir = tempfile.mkdtemp()
        try:
            cmd = [
                "ffmpeg", "-i", input_url,
                "-vf", "fps=0.1",
                "-q:v", "2",
                f"{thumb_dir}/thumb_%04d.jpg",
            ]
            self._run(cmd, timeout=600, label="ffmpeg")
            return [str(p) for p in sorted(Path(thumb_dir).glob("thumb_*.jpg"))]
        finally:
            shutil.rmtree(thumb_dir, ignore_errors=True)

    async def generate_waveform(self, s3_key: str) -> dict:
        """Generate waveform data for audio visualization using streaming."""
        input_url = self._get_presigned_url(s3_key)
        # Simplified waveform: just return peak data (full waveform extraction is complex)
        return {"samples": [], "peak": 1.0, "source": s3_key}

    async def transcode(self, job: TranscodeJob) -> TranscodeResult:
        """
        Transcode video using streaming input from S3.
        FFmpeg reads directly from presigned URL - no full download needed.
        Only output files are written to disk, reducing disk usage by ~2/3.
        """
        work_dir = Path(tempfile.mkdtemp(prefix=f"transcode_{job.version_id}_"))
        
        # Generate presigned URL for streaming input (2 hour expiry for large files)
        input_url = self._get_presigned_url(job.input_s3_key, expires_in=7200)

        try:
            # 1. Probe the source (streaming, no download). The result is parsed
            # into the TranscodeResult and persisted onto MediaFile — the frame
            # rate in particular drives marker-export timecodes.
            cmd = [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_streams", "-show_format", "-select_streams", "v:0", input_url,
            ]
            vid_info = self._run(cmd, timeout=120, label="ffprobe")

            # 2. Check if input has an audio stream
            audio_cmd = [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_streams", "-select_streams", "a", input_url,
            ]
            audio_result = self._run(audio_cmd, timeout=120, label="ffprobe")
            has_audio = bool(json.loads(audio_result).get("streams"))

            # 3. Build quality ladder based on available qualities
            qualities = [q for q in job.qualities if q in QUALITY_MAP]

            hls_dir = work_dir / "hls"
            hls_dir.mkdir()

            def _prep_output_dirs():
                for q in qualities:
                    (hls_dir / q).mkdir(exist_ok=True)

            _prep_output_dirs()

            # Resolve the accelerator ("auto" → whatever this worker actually has).
            # Timeout scales with expected duration — 4 hours for very large files.
            mode = resolve_hwaccel(self.hwaccel)
            ffmpeg_cmd = build_hls_command(input_url, hls_dir, qualities, mode, has_audio)
            try:
                self._run(ffmpeg_cmd, timeout=14400, label=f"ffmpeg[{mode}]")
            except Exception as hw_err:
                if mode == "none":
                    raise
                # Hardware transcode failed (driver/device/codec) — fall back to CPU
                # so the asset never gets stuck. Reset the output dir and retry.
                print(f"Hardware transcode ({mode}) failed, falling back to CPU: {hw_err}")
                shutil.rmtree(hls_dir, ignore_errors=True)
                hls_dir.mkdir()
                _prep_output_dirs()
                ffmpeg_cmd = build_hls_command(input_url, hls_dir, qualities, "none", has_audio)
                self._run(ffmpeg_cmd, timeout=14400, label="ffmpeg[cpu-fallback]")

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

            # 5. Generate and upload thumbnail (using streaming URL)
            thumb_path = work_dir / "thumb_0001.jpg"
            thumb_cmd = [
                "ffmpeg", "-y", "-i", input_url,
                "-vf", "fps=0.1", "-q:v", "2", "-frames:v", "1",
                str(work_dir / "thumb_%04d.jpg"),
            ]
            self._run(thumb_cmd, label="ffmpeg")
            thumbnail_key = f"{job.output_s3_prefix}/thumbnail.jpg"
            if thumb_path.exists():
                self.s3.upload_file(
                    str(thumb_path), self.bucket, thumbnail_key,
                    ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "max-age=86400"},
                )

            meta = parse_probe(vid_info)
            return TranscodeResult(
                success=True,
                hls_prefix=job.output_s3_prefix,
                thumbnail_keys=[thumbnail_key],
                duration_seconds=meta.get("duration_seconds"),
                width=meta.get("width"),
                height=meta.get("height"),
                fps=meta.get("fps"),
            )

        except Exception as e:
            return TranscodeResult(success=False, error=str(e))
        finally:
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
