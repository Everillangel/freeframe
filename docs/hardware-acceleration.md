# Hardware-Accelerated Transcoding (GPU)

Video transcoding (H.264 HLS) is by far the most CPU-intensive thing FreeFrame
does. On modest CPUs it's slow. Offloading the **encode** to a GPU is a large
speedup and frees the CPU. FreeFrame supports four back-ends, chosen with one
env var:

| `TRANSCODER_HWACCEL` | Encoder | Hardware | Compose overlay |
|---|---|---|---|
| `none` (default) | `libx264` | CPU | — |
| `vaapi` | `h264_vaapi` | **Intel** iGPU **and AMD/Radeon** (Linux) | `docker-compose.gpu-vaapi.yml` |
| `qsv` | `h264_qsv` | **Intel** Quick Sync | `docker-compose.gpu-vaapi.yml` |
| `nvenc` | `h264_nvenc` | **NVIDIA** (CUDA) | `docker-compose.gpu-nvidia.yml` |

**Scaling stays on the CPU; only the encode is offloaded** — this keeps the
pipeline simple and robust. If a hardware transcode ever fails (driver/device/
codec quirk), the worker **automatically retries that job on the CPU**, so an
asset can never get stuck.

> Intel iGPU (e.g. an i5-7500 / HD Graphics 630) → use **`vaapi`**. It's the
> simplest and most reliable Intel path; `qsv` is an alternative that may need
> extra runtime bits.

---

## How to enable

Two things: pick the encoder in `.env`, and give the **worker** the GPU via the
matching overlay compose file.

### Intel / AMD (VAAPI)

1. `.env`:
   ```
   TRANSCODER_HWACCEL=vaapi
   ```
2. Start with the VAAPI overlay (adds `/dev/dri` to the worker):
   ```bash
   # dev
   docker compose -f docker-compose.dev.yml -f docker-compose.gpu-vaapi.yml up -d --build
   # prod
   docker compose --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.gpu-vaapi.yml up -d --build
   ```

### NVIDIA (NVENC / CUDA)

Requires the NVIDIA driver **and** `nvidia-container-toolkit` on the host.

1. `.env`:
   ```
   TRANSCODER_HWACCEL=nvenc
   ```
2. Start with the NVIDIA overlay:
   ```bash
   docker compose -f docker-compose.dev.yml -f docker-compose.gpu-nvidia.yml up -d --build
   ```

The `--build` matters — the images now include the Intel/AMD VAAPI drivers.

---

## Verify it's actually using the GPU

**1. The device/driver is visible inside the worker:**
```bash
# VAAPI (Intel/AMD) — should list VAProfileH264* entries
docker compose exec worker vainfo

# NVIDIA — should show your GPU
docker compose exec worker nvidia-smi
```

**2. FFmpeg has the encoder:**
```bash
docker compose exec worker ffmpeg -hide_banner -encoders | grep -E "vaapi|qsv|nvenc"
```
If `h264_nvenc` is missing, the stock ffmpeg build lacks NVENC — you'll need an
ffmpeg build with `--enable-nvenc` (VAAPI/QSV are included in the Debian build).

**3. Watch a real transcode:** upload a video and tail the worker:
```bash
docker compose logs -f worker
```
- GPU working → normal completion, low CPU use (`h264_vaapi`/`h264_nvenc` in the ffmpeg label).
- GPU failing → you'll see `Hardware transcode (...) failed, falling back to CPU` and it still completes on the CPU. Fix the GPU setup, then it'll use it next time.

---

## Notes & tuning

- **`/dev/dri` must exist on the host** for VAAPI/QSV (standard on Linux with the
  `i915` (Intel) or `amdgpu` (AMD) kernel driver). Check: `ls -l /dev/dri`.
- **Non-root worker?** The worker runs as root here, so it can use the render
  device directly. If you run it as a non-root user, add the host's `render`
  group GID to the worker (`group_add`) — find it with `getent group render`.
- **Custom render node?** If your GPU isn't `/dev/dri/renderD128`, set
  `VAAPI_DEVICE=/dev/dri/renderDXXX` in `.env`.
- **Quality/size:** hardware encoders use bitrate (VBR) rather than x264's CRF,
  so at matched quality the files are usually a little larger. The ladder targets
  ~5M/3M/1M for 1080p/720p/360p; adjust in `packages/transcoder/ffmpeg_transcoder.py`
  (`QUALITY_MAP`) if needed.
- **Concurrency:** a single iGPU has limited simultaneous encode sessions. Keep
  `TRANSCODING_CONCURRENCY` modest (1–2) when using hardware encode.
- **Intel QSV** can be fussier than VAAPI in containers; if `qsv` errors and
  falls back to CPU, use `vaapi` instead — it targets the same Intel GPU.
