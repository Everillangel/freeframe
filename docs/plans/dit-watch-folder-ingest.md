# Plan — DIT Watch-Folder Ingest

**Status:** designed, not started · **Priority:** high (core workflow)

## Goal

DITs drop rushes onto a NAS share in their normal structure. FreeFrame then does
**three** things automatically:

1. **Verifies the copy landed intact** (checksums) — nothing is trusted until it hashes correctly.
2. **Makes it reviewable** — H.264 proxy + HLS into MinIO, for the FreeFrame web review.
3. **Makes it editable** — a **ProRes proxy written to an editorial folder** for the cutting room.

```
/mnt/nas/watch/<Project>/<Day>/<Cam>/A001_C003_0714XY.mov
                └ Project   └ Folder └ Folder   └ Asset
```

**2 and 3 are deliberately separate deliverables.** The review proxy is a
streaming format that only makes sense inside FreeFrame; the editorial proxy is a
file on a share that an editor relinks to in Avid/Resolve/Premiere/FCP. Different
codec, different destination, different lifecycle — one ingest, two outputs.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| **Who owns the master copy** | **The NAS folder stays master.** FreeFrame *indexes files in place* and never copies the originals. | Rushes are hundreds of GB. Copying them into MinIO (same NAS) duplicates storage for no gain, and DITs keep their own structure/checksums. |
| **Preview strategy** | **Proxy-first.** Low-res proxy + thumbnail immediately → mark playable → full ladder after. | Browsers cannot play ProRes/BRAW/R3D/ARRIRAW *at all*. A fast proxy is the only workable answer. |
| **FreeFrame is not the backup** | The NAS (plus the DIT's LTO/checksum workflow) remains the backup of record. | Index-in-place means FreeFrame holds no second copy of the originals. |
| **Editorial proxies** | **A second, independent output**: ProRes written to a configured editorial share, mirroring the source folder structure, same basename as the camera original. | Editors conform back to camera originals by filename + timecode + reel. The review proxy (HLS in object storage) is useless for that. |
| **Checksums** | **First-class, not optional.** Verify on ingest, hash the editorial proxy after writing, and re-verify on a schedule. | ⚠️ *This reverses the earlier "read a sidecar if present, don't compute our own" note.* Integrity is now a requirement. |

## Architecture

The blocker: today every `MediaFile` requires an `s3_key_raw` — the model assumes
the original lives in object storage. Index-in-place needs a source that is a
**path on a mounted volume** instead.

```
DIT ──copy──► /mnt/nas/watch/Proj/Day/Cam/clip.mov   (master, read-only, untouched)
                        │
                  watcher (scan + stability check)
                        │
                  ✅ checksum verify  ◄── sidecar MHL / .md5 if present
                        │
              Asset/Version/MediaFile(source_path=…)
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
     review proxy (H.264)   editorial proxy (ProRes)
              │                    │
        MinIO (HLS +          /mnt/nas/editorial/Proj/Day/Cam/clip.mov
        thumbnail)                 │
                              ✅ hash output, record path
```

Reading the source from a local path is **faster** than today's presigned-HTTP
input — ffmpeg reads the file directly. Both outputs come from the same decode
source, so the file is read once per output, not copied first.

---

## Phase 1 · Storage model (schema + transcoder input)

- Add `MediaFile.source_path` (nullable, indexed); make `s3_key_raw` **nullable**.
  A media file is now *either* object-backed (upload) *or* path-backed (ingest).
- Add checksum + editorial columns (see Phases 2 and 6).
- **Service user (blocker).** `Asset.created_by` and `AssetVersion.created_by` are
  `nullable=False` FKs to `users` — an automated watcher has no logged-in user.
  Seed a dedicated **"FreeFrame Ingest" service user** (non-loginable) and attribute
  ingested assets to it. Preferred over making the columns nullable: activity logs
  and the UI keep working unchanged, and it's obvious in the audit trail who acted.
- Alembic migration.
- Transcoder: accept a local path as input (skip presigning when `source_path` is set).
- Serving the **original** (download): no presigned URL exists for a local file →
  add a streaming endpoint that reads from the mounted path, access-controlled and
  **path-jailed** to the watch root (reuse the traversal guard in `hls_proxy.py`).
- Mount the watch root **read-only** into `api` + `worker`; the editorial root is the
  only writable ingest mount (compose overlay).

## Phase 2 · Checksums & integrity

Integrity is the point of a DIT workflow, so this gates everything downstream —
a file that fails verification is **never** ingested or proxied, it's raised as an alarm.

**Three verification points:**

| # | When | Purpose |
|---|---|---|
| 1 | **Ingest gate** — before creating any asset | Prove the card→NAS copy completed and matches the DIT's own hash |
| 2 | **After writing the editorial proxy** | Prove the ProRes landed on the editorial share intact (not truncated) |
| 3 | **Scheduled re-verification** | Catch silent corruption / bit rot on the NAS over time |

**Sidecar first, compute second.** If the DIT's tool wrote a hash manifest, that's
the authority — matching it proves the copy is good end-to-end:
- Parse **ASC MHL / legacy MHL** (XML) sidecars, plus plain `.md5` / `.xxhash` files.
- ⚠️ **Don't assume MD5.** Silverstack, ShotPut Pro and Hedge increasingly write
  **xxHash64** because MD5 is ~10× slower. Store the algorithm alongside the hash and
  support both; MD5 stays the default when *we* compute one, as requested.
- No sidecar → compute our own hash at ingest and treat it as the baseline for
  future re-verification.

**Checksum verification doubles as the stability check.** A hash that matches the
sidecar is far stronger proof that a copy finished than the size+mtime heuristic in
Phase 3. Where a sidecar exists, prefer it; fall back to size+mtime only when it doesn't.

**Schema** (on `MediaFile`, or the ingest ledger):
`checksum`, `checksum_algo` (`md5`/`xxhash64`), `checksum_source` (`sidecar`/`computed`),
`checksum_status` (`pending`/`verified`/`mismatch`/`missing`), `checksum_verified_at`.

> ⚠️ **Cost — plan for this.** Hashing is a **full extra read** of every file and is
> I/O-bound. MD5 runs ~400–600 MB/s per core; a 2 TB shoot day is ~1 hour of pure
> disk contention *on top of* the transcode read. Mitigations: run hashing on a
> throttled low-priority queue, allow off-peak scheduling, make periodic
> re-verification opt-in and rate-limited, and offer xxHash64 for speed when the DIT's
> manifest uses it.

**A mismatch is an incident, not a log line** — surface it loudly in the control
panel (Phase 7), never auto-delete, never silently retry.

## Phase 3 · Watcher

- A Celery beat task (scan) or a small watchdog/inotify service. **Start with a
  scheduled scan** — simpler, survives restarts, and handles NFS/SMB where inotify
  is unreliable.
- **File-stability detection** (critical): never ingest a file still being copied.
  Require size+mtime unchanged across two consecutive scans (configurable), or a
  sidecar hash match (Phase 2), or an explicit `.done` marker if the DIT's tool writes one.
- Idempotency: dedupe on `source_path` (+ size/mtime) so rescans don't re-create
  assets. Ignore hidden/partial files (`.`, `~`, `.tmp`, growing files).
- Scale: thousands of files/day — the scan must be **incremental**, not a full tree
  stat every minute.

## Phase 4 · Path → hierarchy mapping

- `<root>/<Project>/<Day>/<Cam>/<file>` → find-or-create Project, nested Folders
  (Day → Cam), then Asset + Version + MediaFile.
- Make the depth/segment meaning **configurable** — not every shoot is Project/Day/Cam.
  Editable per watch root in the control panel (Phase 7).
- Record Day/Cam as asset metadata so they're filterable in the UI.

## Phase 5 · Review proxy (proxy-first transcoding)

- Split the job: **(a)** thumbnail + one low-res proxy (360p) on a *high-priority*
  queue → mark the version playable; **(b)** the full ladder on a background queue.
- Needs a `processing_status` nuance — the enum is currently only
  `uploading/processing/ready/failed`, so add e.g. `preview_ready` for "play the proxy
  while the rest finishes".
- Bulk ingest = thousands of clips: cap concurrency, prefer GPU encode
  (`TRANSCODER_HWACCEL=auto`, see [hardware-acceleration.md](../hardware-acceleration.md)).

## Phase 6 · Editorial ProRes deliverable

A separate output with different rules from the review proxy. **What editors need is
relinkability**, so metadata fidelity matters more than picture quality.

- **Codec:** `prores_ks`, profile configurable — `0` = 422 Proxy (default), `1` = LT.
- **Audio:** PCM (`pcm_s16le`/`s24le`), **all channels preserved** — don't downmix.
- **Timecode:** carry `start_timecode` from the source through with `-timecode`.
  ⚠️ Without it the proxies **will not conform** back to camera originals.
- **Reel/tape name:** preserve where the source carries it.
- **Filename:** identical basename to the camera original — relinking depends on it.
- **Layout:** mirror the source structure under the editorial root
  (`/mnt/nas/editorial/<Project>/<Day>/<Cam>/`).
- Container `.mov`; resolution configurable (full-res or half-res).
- Record the output path + hash on the media file so the panel can show
  "editorial proxy: ready / missing / failed".

> ⚠️ **This is CPU-only, and it's the capacity risk in this plan.**
> **ffmpeg has no GPU ProRes encoder** — NVENC/VAAPI/QSV do not encode ProRes, so
> `TRANSCODER_HWACCEL` (which we built for the review proxy) **does not help here at
> all**. On the i5-7500 this is slow: budget roughly real-time-or-worse per stream and
> treat a shoot day as an overnight job. Put it on its own low-priority queue with
> capped concurrency so it can never starve review proxies, which are the
> time-sensitive output.

> ⚠️ **Storage:** ProRes 422 Proxy @1080p ≈ 45 Mbps ≈ **~20 GB/hour**; LT ≈ 102 Mbps ≈
> **~45 GB/hour**. Size the editorial share deliberately and decide a retention policy —
> these are regenerable, so they're the first thing to purge.

**Open question — Avid.** Avid editors normally want **DNxHR in MXF**, not ProRes;
ProRes support in Avid is version/platform dependent. Since we already export markers
for Avid, confirm with the cutting room before committing. Encoder path would be
`dnxhd`/`dnxhr_lb` in `.mxf` — same pipeline, different profile, so design the output
as **pluggable "editorial format" presets** rather than hardcoding ProRes.

## Phase 7 · DIT control panel (web)

A dedicated admin page (`/admin/ingest`) so a DIT configures everything without
touching `.env` or the server.

**Config lives in the DB, not env.** `InstanceSettings` is a *singleton* table, so
this needs its own:

- **`ingest_roots`** — name, watch path, enabled, target project (or "derive from
  path"), path template, extension allow-list, stability seconds, scan interval,
  checksum mode, editorial enabled/path/preset.
- **`ingest_files`** — the ledger: root, `source_path` (unique), size, mtime, checksum
  + status, state, resulting asset/version, error, timestamps. Powers dedupe, the
  dashboard, retries, and the audit trail.
- `MediaFile` gains `source_path`, checksum columns, `editorial_path`.

**Panel sections:**

| Section | Does |
|---|---|
| **Watch folders** | Add/edit/remove roots, enable/disable, scan interval, stability window, extensions |
| **Project assignment** | Map a root (or subfolder) → FreeFrame project; edit the `<Project>/<Day>/<Cam>` template; set a fallback project |
| **Editorial output** | Per root: on/off, destination path, format preset (ProRes Proxy/LT, DNxHR), resolution |
| **Integrity dashboard** | Per-file checksum status, counts, **mismatches surfaced as alarms**, manual re-verify, sidecar-found indicator |
| **Queue & health** | Last scan, queue depth, in-flight jobs, failures with retry |
| **Activity** | What was ingested when, by which root |

> 🔒 **Security — this page is the sharp edge of the whole feature.** It lets an admin
> type **arbitrary filesystem paths** into a service that reads (watch root) and
> **writes** (editorial root) as the container user. Unconstrained, that's arbitrary
> file read and arbitrary file write via the web UI.
> **Required controls:**
> - An **env-defined allow-list** (`INGEST_ALLOWED_ROOTS`) of permitted base paths — the
>   UI can only ever configure paths *underneath* those.
> - Validate every configured path with `os.path.realpath` **before** the jail check, so
>   symlinks and `..` can't escape. Same guard pattern as `hls_proxy.py`.
> - **Super-admin only**, and every config change written to the activity log.
> - Keep the watch mount **read-only**; only the editorial root is writable.

## Phase 8 · Asset-level UI

- Ingest state on the asset (queued / verifying / proxying / ready), source path, Day/Cam.
- Checksum badge (verified / mismatch) and editorial-proxy status on the asset detail.

---

## ⚠️ Open questions / risks

- **RAW is a hard blocker, not a setting.** Stock ffmpeg **cannot decode BRAW, R3D or
  ARRIRAW** — those need vendor SDKs (Blackmagic RAW SDK, REDline, ARRI SDK), each with
  its own licensing and Linux support story. **ProRes and H.264/265 are fine.**
  *Confirm what the DITs actually hand over* — if it's RAW, that's a separate spike
  before this plan is viable. (This affects the editorial proxy too: no decode = no ProRes out.)
- **Deletion policy:** if a DIT deletes/moves a file on the NAS, does the asset
  disappear, go "offline", or stay with a broken source? (Recommend: mark offline,
  never auto-delete review data/comments. Note this will also read as a checksum
  failure — distinguish "missing" from "corrupt".)
- **Editorial proxy retention:** regenerable, so they're the first purge candidate —
  but deleting one an editor has already relinked breaks their timeline. Decide before shipping.
- **Avid format:** ProRes vs DNxHR/MXF — confirm with the cutting room (Phase 6).
- **Permissions:** the watch share must be readable by the container UID; the editorial
  share writable by it. Keep them separate mounts.
- **Scale:** thousands of files/day — scan incremental, hashing throttled, ProRes queue capped.

## Definition of done

A DIT copies a card into `/<Project>/<Day>/<Cam>/` and, without touching FreeFrame:

1. Every file is **checksum-verified** against the DIT's manifest (or baselined if none),
   and any mismatch is raised loudly.
2. Clips appear in the right project/folder within minutes and are **playable at proxy
   quality** in the browser, full ladder finishing in the background.
3. A **ProRes proxy** with correct timecode and matching filename lands in the editorial
   folder, ready for the cutting room to relink.
4. **No original was copied, moved or modified**, and all of it was configured from the
   DIT control panel rather than the server.
