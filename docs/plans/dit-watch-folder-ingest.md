# Plan — DIT Watch-Folder Ingest

**Status:** designed, not started · **Priority:** high (core workflow)

> **New to film/DIT?** Read [film-dit-primer.md](film-dit-primer.md) first — it
> explains the production workflow this plan reaches into, so the choices below
> read as consequences of how film data handling actually works.

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
| **Zero-config drop path** | **The default watch root works with no admin interaction.** Structure-on-disk is the config; the control panel is an *override*, never a prerequisite. | DITs use their own tools (ShotPut Pro, Hedge, Silverstack) and expect to offload and walk away. Requiring a web page per shoot would not survive contact with a set. |
| **RAW decoding** | **Pluggable decoder tiers**, off by default. Prefer a **DaVinci Resolve Studio render node** over integrating vendor SDKs one by one. | It varies house to house, so we need a wide net rather than a fixed list. One $295 perpetual licence decodes every major RAW format — including the two with no Linux SDK at all. |
| **Layout assumptions** | **Assume nothing. Detect, with a fallback that always works.** No fixed folder template, no "one file = one clip". | Structure changes project to project and house to house. Any convention we hardcode will be wrong on the next job — so an unrecognised layout must still ingest sensibly rather than fail. |

## Governing principle: widest possible scope

Everything about what lands in the watch folder **varies project to project**: folder
depth and meaning, camera card layout, whether a clip is a file or a directory, whether
proxies already exist, whether sound is dual-system. So the rule throughout this plan is:

> **Detect rather than configure; degrade rather than fail.**
> Every strategy is pluggable and auto-selected, every detection has a fallback, and the
> final fallback — "I don't recognise this at all" — still produces a usable asset.
> Configuration (Phase 7) only ever *overrides* a detection, never enables one.

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
- ⚠️ **`source_path` is not always a file.** Add `source_kind`:
  `file` · `directory` (RED `.RDC`, XDROOT clips) · `sequence` (DPX/EXR/ARRIRAW frames)
  · `spanned` (a clip split across several files/cards). Sequences also need a pattern +
  frame range rather than a single path. **Dedupe on clip identity, not on file path** —
  a 10,000-frame DPX sequence is *one* asset, not 10,000.
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

### 3a · The zero-config SMB drop path (primary workflow)

**A DIT must be able to offload and walk away without ever opening FreeFrame.**
The default watch root is always enabled and needs no setup:

- **Convention over configuration.** The path *is* the config: the top-level folder
  name becomes the project (find-or-create), the rest maps to folders per the default
  template. A new shoot is a new folder — nothing to register.
- **SMB is the NAS's job, not ours.** The DIT writes to an SMB share published by the
  NAS (Synology/QNAP/TrueNAS); FreeFrame just mounts that same path **read-only**. We
  are not implementing an SMB server — we're a second reader of a share the NAS already
  serves. (CIFS mount options belong in the compose overlay.)
- **The control panel is optional.** It exists to override defaults (retarget a project,
  change the editorial preset, disable a root) — never to enable the basic flow.

**ShotPut Pro / Hedge / Silverstack integration comes free via the manifest:**

> 💡 **The MHL is the completion signal.** ShotPut Pro writes its hash manifest only
> **after** a verified offload finishes. So "a manifest appeared that covers this file"
> is a *far* stronger and faster trigger than watching size+mtime settle — it's the
> DIT's own tool telling us the copy is done and verified.

- Watch for `.mhl` / ASC MHL arrival and treat it as the ingest trigger for every file
  it covers; fall back to the size+mtime heuristic only for files with no manifest.
- Handle **both** layouts: a per-job manifest at the offload root covering many files,
  and per-file sidecars.
- ⚠️ ShotPut defaults to **xxHash64** in current versions, not MD5 — another reason the
  algorithm must be stored per-file (Phase 2), not assumed.
- **Ignore list matters on SMB shares:** `.DS_Store`, `._*` AppleDouble files,
  `Thumbs.db`, plus ShotPut's own PDF/HTML reports — none are media.
- ⚠️ **SMB caveats:** inotify is unreliable over CIFS (hence scheduled scanning), and
  mtime granularity can be coarse (~2s), which weakens the stability heuristic — further
  reason to prefer the manifest signal where one exists.

## Phase 4 · Detection & mapping

The widest-scope core. Four independent detectors, each with a fallback, run before
anything is created. **None of them may block ingest on failure.**

### 4a · Clip grouping — "what is one asset?"

⚠️ **The plan can no longer assume one file = one clip.** Real deliveries include:

| Shape | Example | Handling |
|---|---|---|
| **Single file** | `A001_C003.mov`, `.braw`, `.mxf` | The simple case |
| **Directory-as-clip** | RED `A001_C001_0714XY.RDC/`, Sony `XDROOT/Clip/` | Group the directory into **one** asset |
| **Image sequence** | `shot_0001.dpx` … `shot_9999.dpx`, EXR, ARRIRAW `.ari` | Collapse thousands of frames into **one** asset (pattern + frame range); detect gaps |
| **Spanned / chaptered** | GoPro `GH010123`/`GH020123`, FAT32 4 GB splits, cards spanned mid-take | Group into one asset, ordered — or at minimum keep them adjacent, never silently drop |

Detection order: known camera-card layouts → directory heuristics → sequence pattern
matching → single file. **Fallback: treat it as a single file.** Getting this wrong
creates thousands of junk assets, so grouping decisions should be visible and
overridable in the panel.

### 4b · Structure → hierarchy

- `<Project>/<Day>/<Cam>` is **one convention among many** — others put camera first,
  date first, unit/block in the path, or dump flat with everything in the filename.
- Detect against a **library of known patterns**, plus user-supplied templates.
- ✅ **Universal fallback (must always work):** project = top-level folder name
  (find-or-create), and mirror the remaining relative path as nested folders at whatever
  depth it happens to be. An unrecognised layout produces a *correct if unglamorous*
  result — never an error.
- Record whatever segments were identified (day/cam/unit) as asset metadata for filtering.

### 4c · Sidecars & companions — "what is not an asset?"

Media folders are full of files that must **not** become assets, but often carry useful data:

- **Hash manifests** — MHL/ASC MHL, `.md5` → Phase 2 (integrity + completion trigger).
- **Metadata** — ALE, Sony/ARRI/Canon XML, Silverstack CSV → enrich asset metadata
  (scene/take/reel/lens/ISO/ND, and camera-reported timecode).
- **Look files** — `.cube` LUTs, `.cdl`/`.ccc` CDLs → attach; optionally apply to proxies
  so review matches the intended look rather than flat log.
- **Junk** — `.DS_Store`, `._*`, `Thumbs.db`, ShotPut reports, `.tmp`/partials → ignore.
- **Fallback:** an unrecognised non-media file is ignored, never ingested.

### 4d · Dual-system sound

Sound recorders (Sound Devices, Zaxcom) drop poly/mono WAVs in their own folder, often
with BWF timecode and a sound report. Widest scope means: **recognise them as audio, not
as broken video.** Ingest as audio assets at minimum; matching to picture by
timecode/scene-take is a later enhancement, not a blocker.

### 4e · Use proxies that already exist ⭐

Many houses deliver **RAW *and* already-made ProRes/H.264 dailies side by side**. If a
matching proxy is already present:

- Prefer it as the transcode source (far cheaper than decoding RAW), and
- Consider it as the **editorial deliverable directly** — potentially skipping Phase 6's
  expensive CPU-only ProRes encode entirely.

This is the single biggest performance win available, and it costs nothing but detection.

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

A dedicated admin page (`/admin/ingest`) so a DIT can configure things without
touching `.env` or the server.

> **This page is an override layer, not a gate.** Per Phase 3a the default drop path
> must work with zero visits here. Everything below has a working default; the panel
> changes defaults, inspects integrity, and fixes failures.

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
| **Project assignment** | Map a root (or subfolder) → FreeFrame project; override the detected structure template; set a fallback project |
| **Detection overrides** | Inspect what the detectors decided (structure, clip grouping, sidecars) and correct them — per root *and per project*, since conventions differ per job |
| **Editorial output** | Per root **and per project**: on/off, destination path, format preset (ProRes Proxy/LT, DNxHR/MXF), resolution |
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

## Source formats & decoder tiers

What arrives **varies edit house to edit house**, so this is designed as a wide net
rather than a fixed list: a **pluggable decoder registry**. Probe the file → pick a
decoder → every decoder emits the same intermediate, so the review-proxy (Phase 5) and
editorial-ProRes (Phase 6) stages are unchanged regardless of source format.

> 💡 **For review proxies we don't need reference-quality decode — just a watchable
> picture.** That lowers the bar substantially. Reference-grade colour science only
> matters for the editorial deliverable.

### Tier 0 — free, works today (probably most of what actually arrives)

Stock ffmpeg already handles **ProRes, DNxHD/DNxHR, XAVC, XF-AVC, AVC-Intra, H.264/265
and CinemaDNG** with no SDK. In practice most houses send **ProRes/DNxHR dailies for
review, not RAW** — the DIT has already made them. ✅ *Worth confirming per house before
building anything below.*

### Tier 1 — DaVinci Resolve Studio render node ⭐ recommended next

**$295 one-time, perpetual, per machine.** Resolve already licenses every vendor SDK,
so a single integration decodes **BRAW, R3D, ARRIRAW, X-OCN, Canon CRM and ProRes RAW** —
including the two formats with **no Linux SDK at all**. One integration instead of five.
As a post house you may already own licences.

Driven headlessly as a "RAW render node" via Resolve's Python scripting API.
⚠️ **Spike required before committing:** Linux support is officially Rocky/CentOS,
headless operation typically still needs a virtual display (Xvfb), and each render node
needs its own licence.

### Tier 2 — free vendor SDKs (worth it only if that format dominates)

| Format | SDK cost | Linux | Access |
|---|---|---|---|
| **Blackmagic RAW** (.braw) | **Free**, no ongoing fees | ✅ | Public download, no gatekeeping |
| **REDCODE** (.r3d) | **Royalty-free** | ✅ | Register with RED + sign SDK agreement |

### Tier 3 — gated or impossible on Linux

| Format | Status |
|---|---|
| **ARRIRAW** | SDK behind the ARRI Partner Program — **but a free ARRI Reference Tool CLI exists**, which may be enough to shell out to |
| **X-OCN** (Sony Venice) | Apply to Sony's third-party licence programme |
| **Cinema RAW Light** (.crm) | ❌ **No Linux** — Windows/macOS only. Resolve node or a Mac/Win worker |
| **ProRes RAW** | ❌ **No Linux** — Resolve node or a Mac/Win worker |

### The real costs aren't licence fees

1. **Distribution licensing** — proprietary SDKs **cannot be bundled** into a public MIT
   repo or Docker image. The operator downloads and mounts them → forces the plugin
   design, and is why RAW support ships **off by default**.
2. **Engineering time** — each SDK is a separate C++ integration. This dominates.
3. **Hardware** — R3D 8K decode wants a real GPU; the **i5-7500 iGPU will not cope**.

**Sequencing:** Tier 0 now → Resolve node → BRAW/R3D SDKs only if those dominate →
Sony/ARRI on demand.

## Phase 8 · Asset-level UI

- Ingest state on the asset (queued / verifying / proxying / ready), source path, Day/Cam.
- Checksum badge (verified / mismatch) and editorial-proxy status on the asset detail.

---

## ⚠️ Open questions / risks

- **What do the edit houses actually deliver for review — RAW, or dailies?** This is the
  single highest-value question to ask, and it's *unanswered*. If they send ProRes/DNxHR
  dailies (common), Tier 0 covers everything and the whole decoder question is moot.
  See [Source formats & decoder tiers](#source-formats--decoder-tiers). Note this gates
  the editorial proxy too: no decode = no ProRes out.
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

A DIT offloads a card to the SMB share with their own tool (ShotPut Pro, Hedge,
Silverstack) into `/<Project>/<Day>/<Cam>/` and, **without ever opening FreeFrame**:

0. **Whatever the layout**, it ingests sensibly — a recognised convention maps cleanly, an
   unrecognised one still lands in a correct project/folder tree, and clips that are
   directories, image sequences or spanned files each become **one** asset rather than
   thousands.
1. Every file is **checksum-verified** against the DIT's manifest (or baselined if none),
   and any mismatch is raised loudly.
2. Clips appear in the right project/folder within minutes and are **playable at proxy
   quality** in the browser, full ladder finishing in the background.
3. A **ProRes proxy** with correct timecode and matching filename lands in the editorial
   folder, ready for the cutting room to relink.
4. **No original was copied, moved or modified** — and none of the above required a
   visit to the control panel. The panel is there to *override* and to investigate
   failures, not to make the workflow run.
