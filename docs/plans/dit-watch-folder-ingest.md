# Plan — DIT Watch-Folder Ingest

**Status:** designed, not started · **Priority:** high (core workflow)

## Goal

DITs drop rushes onto a NAS share in their normal structure and FreeFrame picks
them up automatically, makes them reviewable fast, and shares them — no manual
uploading.

```
/mnt/nas/watch/<Project>/<Day>/<Cam>/A001_C003_0714XY.mov
                └ Project   └ Folder └ Folder   └ Asset
```

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| **Who owns the master copy** | **The NAS folder stays master.** FreeFrame *indexes files in place* and only stores **proxies + thumbnails** in MinIO. | Rushes are hundreds of GB. Copying them into MinIO (which lives on the same NAS) would duplicate storage for no gain, and DITs keep their own structure/checksums. |
| **Preview strategy** | **Proxy-first.** Generate a low-res proxy + thumbnail immediately, mark playable, then the full ladder. | Browsers cannot play ProRes/BRAW/R3D/ARRIRAW *at all*, so "untranscoded viewing" isn't generally possible. Fast proxy is the only workable answer. |
| **FreeFrame is not the backup** | The NAS (and the DIT's own LTO/checksum workflow) remains the backup of record. | Index-in-place means FreeFrame holds no second copy of the originals. |

## Architecture

The blocker: today every `MediaFile` requires an `s3_key_raw` — the model assumes
the original lives in object storage. Index-in-place needs a source that is a
**path on a mounted volume** instead.

```
DIT ──copy──► /mnt/nas/watch/Proj/Day/Cam/clip.mov   (master, untouched)
                        │
                  watcher (scan + stability check)
                        │
              Asset/Version/MediaFile(source_path=…)
                        │
              proxy-first transcode (ffmpeg reads the LOCAL path)
                        │
                  MinIO ◄── proxy HLS + thumbnail only
```

Reading the source from a local path is actually **faster** than today's
presigned-HTTP input — ffmpeg reads the file directly.

## Phases

### 1 · Storage model (schema + transcoder input)
- Add `MediaFile.source_path` (nullable, indexed) and make `s3_key_raw` nullable.
  A media file is now *either* object-backed (uploads) *or* path-backed (ingest).
- Alembic migration.
- Transcoder: accept a local path as input (skip presigning when `source_path` set).
- Serving the **original** (download): no presigned URL exists for a local file →
  add a streaming endpoint that reads from the mounted path, access-controlled and
  path-jailed to the watch root (reuse the traversal guard pattern from `hls_proxy`).
- Mount the watch root **read-only** into `api` + `worker` (compose overlay).

### 2 · Watcher
- A Celery beat task (scan) or a small watchdog/inotify service. **Start with a
  scheduled scan** — simpler, survives restarts, and handles NFS/SMB where inotify
  is unreliable.
- **File-stability detection** (critical): never ingest a file still being copied.
  Require size+mtime unchanged across two consecutive scans (configurable), or an
  explicit `.done`/sidecar marker if the DIT's tool writes one.
- Idempotency: dedupe on `source_path` (+ size/mtime) so rescans don't re-create
  assets. Ignore hidden/partial files (`.`, `~`, `.tmp`, growing files).
- Config: `INGEST_WATCH_ROOT`, `INGEST_SCAN_INTERVAL`, `INGEST_STABLE_SECONDS`,
  extension allow-list.

### 3 · Path → hierarchy mapping
- `<root>/<Project>/<Day>/<Cam>/<file>` → find-or-create Project, nested Folders
  (Day → Cam), then Asset + Version + MediaFile.
- Make the depth/segment meaning **configurable** (not every shoot is Project/Day/Cam).
- Record Day/Cam as asset metadata so they're filterable in the UI.

### 4 · Proxy-first transcoding
- Split the job: **(a)** thumbnail + a single low-res proxy (360p) on a *high-priority*
  queue → mark the version playable; **(b)** the full ladder on a background queue.
- Needs a `processing_status` nuance (e.g. `preview_ready`) so the UI can play the
  proxy while the rest finishes.
- Bulk ingest of a shoot day = thousands of clips: cap concurrency, and prefer GPU
  encode (`TRANSCODER_HWACCEL=auto`, see [hardware-acceleration.md](../hardware-acceleration.md)).

### 5 · UI
- Ingest state on the asset (queued / proxying / ready), source path, Day/Cam.
- An admin "Ingest" view: watched roots, last scan, queue depth, failures.

## ⚠️ Open questions / risks

- **RAW is a hard blocker, not a setting.** Stock ffmpeg **cannot decode BRAW,
  R3D or ARRIRAW** — those need vendor SDKs (Blackmagic RAW SDK, REDline, ARRI
  SDK), each with its own licensing and Linux support story. **ProRes and H.264/265
  are fine.** *We still need to confirm what the DITs actually hand over* — if it's
  RAW, that's a separate spike before this plan is viable.
- **Deletion policy:** if a DIT deletes/moves a file on the NAS, does the asset
  disappear, go "offline", or stay with a broken source? (Recommend: mark offline,
  never auto-delete review data/comments.)
- **Checksums:** DITs verify with MHL/xxHash (Silverstack/Hedge). Do we record/verify
  them, or stay out of the way? (Recommend: read a sidecar MHL if present, don't
  compute our own.)
- **Permissions:** the watch share must be readable by the container UID; keep it
  read-only so FreeFrame can never damage the master.
- **Scale:** thousands of files per day — scan must be incremental (don't stat the
  whole tree every minute).

## Definition of done
A DIT copies a card into `/<Project>/<Day>/<Cam>/`; within minutes the clips appear
in the right project/folder, are playable at proxy quality, no original was copied
or modified, and the full ladder finishes in the background.
