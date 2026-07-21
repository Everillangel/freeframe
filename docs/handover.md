# FreeFrame Fork — Handover

_Last updated: 2026-07-20. This is a living handover for `Everillangel/freeframe`,
a customized fork of upstream `Techiebutler/freeframe` (self-hosted Frame.io
alternative; FastAPI + Next.js) run for a production/post house._

---

## 1. Current state (at a glance)

| Thing | Value |
|---|---|
| Repo | `github.com/Everillangel/freeframe` (`origin`), upstream = `Techiebutler/freeframe` |
| Branch | `main` — everything is on `main`, pushed, working tree clean |
| HEAD | `7abe811` — "Anchor history to upstream/main" |
| Upstream sync | **0 behind / 375 ahead** of `upstream/main`; latest upstream release merged is **v1.6.0** (+ 5 post-v1.6.0 fixes) |
| Deploy target | Self-hosted Linux server, reached over Tailscale (dev compose behind a local reverse proxy) — see `docs/deployment.md` |
| CI | GitHub Actions on the fork — Lint / Backend Tests / Frontend Build / Docker Build, all green on HEAD |
| Tests (local) | **208 backend + 245 frontend**, all passing — see §4 |

---

## 2. ⚠️ Deployment action items (do these on the server)

History was rewritten and tags were force-pushed, so the server clone **cannot
fast-forward** — it must hard-reset. In order:

```bash
# On the server, in the freeframe checkout:
git fetch origin --tags --force
git reset --hard origin/main          # history was anchored/rewritten — plain pull will not work
docker compose -f docker-compose.dev.yml up -d --build   # rebuild for the new code
```

Then, **once**, populate frame rates for existing media (fixes the export bug for
already-uploaded assets — see §3):

```bash
curl -X POST http://localhost:8000/admin/backfill-media-metadata \
  -H "Authorization: Bearer <superadmin-token>"
```

> Why the hard reset: upstream rewrote their git history, so our fork was anchored
> to `upstream/main` with a `-s ours` merge and the version tags (v1.0.0–v1.4.1)
> were force-updated to match upstream. Any existing clone has divergent tags and
> history. `git reset --hard` + `--tags --force` is the clean way to realign.

---

## 3. What changed this session (2026-07-20)

### A. Synced to upstream v1.6.0, then to upstream tip (+5 commits)

Upstream **rewrote their git history**, so there was no common ancestor
(`git merge-base` was empty) — a normal merge was impossible. Because our old
v1.4.1 tree and upstream's new v1.4.1 tree were **byte-identical**, the
v1.4.1→tip changes were ported as **3-way patches** instead, in two steps
(`v1.4.1..v1.6.0`, then `v1.6.0..4696c99`), then the history was **anchored** to
`upstream/main` with `git merge -s ours` so ahead/behind is meaningful again.

**Gained from upstream:** version compare / wipe viewer, synced transport,
stream-url hook, auth + image-processor fixes, audio-duration persistence,
configurable CORS (`CORS_ALLOW_ORIGINS`), `S3_PUBLIC_ENDPOINT` ignored in AWS-S3
mode, LAN/HTTP invite-link copy, magic-code token persistence, overridable dev
compose.

**Kept ours where ours is unique/better** (both sides had independently built
these):
- **Comment export** — ours supports **Avid** (upstream has none) and matches real
  Frame.io reference output per NLE; drop-frame verified against SMPTE vectors.
  Upstream's duplicate `/comments/export` route + client-side export flow + 4 tests
  were removed (they targeted the implementation we rejected and would have
  `AttributeError`'d against our module).
- **GPU transcoding** (`TRANSCODER_HWACCEL`) — upstream has none. Kept, plus our
  defensive `parse_probe`, while also keeping upstream's `parse_probe_metadata`
  for `get_video_metadata`.

**Deliberately NOT adopted (upstream bug):** upstream's dev compose sets
`MINIO_CORS_ALLOW_ORIGIN` / `_METHODS` / `_HEADERS` / `_EXPOSE_HEADERS`. MinIO reads
CORS from its **`api` config subsystem**, so the real variable is
`MINIO_API_CORS_ALLOW_ORIGIN` (verified against MinIO docs). The four upstream
added are **not recognised and silently do nothing** — meaning upstream's dev
compose has broken MinIO CORS. We kept our working var, now overridable via
`${MINIO_CORS_ALLOW_ORIGIN:-*}`. _Worth reporting upstream._

### B. Added FCPXML export + fixed a live fps bug

- New export format **`fcpxml`** (FCPXML 1.9, imports natively into FCP 10.4+),
  alongside the existing `fcp` fiojson (Frame.io's proprietary payload). Closes
  backlog item #4. NTSC rates written as exact fractions (`1001/30000s`) so FCP
  doesn't drift markers. Six formats now: `resolve, premiere, avid, fcp, fcpxml, csv`.
- **Bug fixed:** the export endpoint still did `fps or media_file.fps or 30.0`, so
  any version with no stored frame rate **silently exported at 30 fps** — shifting
  every marker on 24/25/50 fps media. It now returns **422 `fps_required`** rather
  than guessing; the UI prompts for the rate and retries.
  ⚠️ **Behaviour change:** any automated caller hitting this endpoint against
  fps-less media now gets a 422 instead of a (wrong) file.

### C. History/tags realignment

Anchored to `upstream/main` (`-s ours`, tree unchanged) and force-synced all 15
version tags to match upstream. `git fetch upstream && git merge upstream/main`
now behaves normally going forward.

---

## 4. Local testing (now fully set up on this machine)

Previously "no local deps, rely on CI." **That is no longer true** — the full
suite runs locally. No Docker on this machine; Postgres lives in WSL2.

**Frontend** (`apps/web`; pnpm 10.15.0 installed globally):
```bash
cd apps/web
pnpm exec tsc --noEmit && pnpm test      # tsc clean + 245 tests in ~8s
```

**Backend** (`.venv` at repo root — **Python 3.12.13** via `uv`, matching CI; the
system Python 3.14 can't build pinned `pydantic==2.9.2`):
```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/freeframe_test" \
  REDIS_URL="redis://localhost:6379/0" S3_BUCKET="freeframe-test" \
  S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="testkey" \
  S3_SECRET_KEY="testsecret" S3_REGION="us-east-1" \
  JWT_SECRET="ci-test-secret-key-not-for-production" FRONTEND_URL="http://localhost:3000"
./.venv/Scripts/python.exe -m pytest apps/api/tests/ -q      # 208 passed in ~2m50s
```
The env vars are **required even for mocked tests** (config validation). Recreate
the venv with `uv venv --python 3.12 .venv` then
`uv pip install --python .venv -r apps/api/requirements.txt`.

**Postgres is in WSL2 Ubuntu** (PG 18, cluster `18/main`, role `user`/`pass`, db
`freeframe_test`, listening on `*`). WSL2 localhost-forwarding means Windows
reaches it at `localhost:5432` with no extra config. **It stops when WSL shuts
down** — restart with:
```bash
wsl.exe -d Ubuntu -u root -- pg_ctlcluster 18 main start
```
(`wsl.exe -u root` needs no password; the `thor` user's sudo does.) ~21 tests need
real Postgres (`test_cleanup_soft_deleted`, `test_orphan_sweep`,
`test_reap_stale_uploads`, `test_share_link_expiry`,
`test_storage_usage_integration`, `test_backfill_media_metadata`); the rest mock
the DB.

⚠️ **CI's `Type check` step is `continue-on-error: true`** — a TypeScript error
would NOT fail CI. Run `tsc --noEmit` locally before trusting a green build.

---

## 5. What this fork adds on top of upstream

All documented under `docs/`:

| Feature | Where | Docs |
|---|---|---|
| **NAS storage via MinIO** | `docker-compose.*`, `s3_service.py` | `docs/nas-storage.md` |
| **NLE comment export** (Avid/Resolve/Premiere/FCP fiojson/FCPXML/CSV, Frame.io-matching, auto drop-frame) | `services/comment_export.py`, `routers/comments.py`, `components/review/comment-panel.tsx` | `docs/comment-export.md` |
| **GPU transcoding** (`TRANSCODER_HWACCEL=auto`, VAAPI/QSV/NVENC) | `packages/transcoder/ffmpeg_transcoder.py`, `docker-compose.gpu-*.yml` | `docs/hardware-acceleration.md` |
| **Media metadata capture** (fps/res/duration) + backfill | `tasks/transcode_tasks.py`, `tasks/metadata_tasks.py`, `POST /admin/backfill-media-metadata` | — |
| **POPIA (ZA) data-subject controls** + retention | `services/privacy_service.py`, `routers/privacy.py`, `tasks/retention_tasks.py` | `docs/security-hardening.md` |
| **Host-independent access** (relative `/api`, no CORS) | `next.config.js`, `middleware.ts`, `utils/base_url.py`, `utils/client_ip.py` | `docs/deployment.md` |
| **Media inspector** (fps/res/duration, warns on unknown fps) | `components/review/media-info.tsx` | — |

**Key design decisions:** MinIO-on-NAS over a filesystem backend; `S3_PUBLIC_ENDPOINT`
is the *only* host-coupled setting (presigned URLs can't be relative — accepted);
`FRONTEND_URL` is only for outbound email links, not access.

---

## 6. Planned work & backlog

Full write-ups in `docs/plans/`:

- **`dit-watch-folder-ingest.md`** — biggest planned feature. DITs drop rushes on
  an SMB share; FreeFrame checksums them, makes review proxies, and writes editorial
  ProRes to a second share — all zero-config (control panel is an override, not a
  gate). Governing principle: **detect rather than configure; degrade rather than
  fail**. Includes a pluggable decoder-tier plan for RAW (ffmpeg-native → Resolve
  Studio node → BRAW/R3D SDKs → gated Sony/ARRI). **Open question blocking it:** do
  the edit houses deliver RAW or ProRes/DNxHR dailies? If dailies, most of the
  decoder work is moot.
- **`nle-integrations.md`** — NLE panel integrations (needs API tokens/PAT first).
- **`backlog.md`** — smaller items. Live ones:
  - #2 Reconcile the two retention systems (ours `purge_expired_data` + upstream
    `cleanup_soft_deleted`) and fix the `RETENTION_ERASE_AFTER_DAYS=0` footgun
    (0 currently = "anonymise immediately", opposite of "off").
  - #1 Auto-deinterlace review proxies (combing on 1080i sources).
  - #3 Refresh-token rotation/revocation.
  - #5 (partly done — upstream added audio duration) image dimensions still not
    captured; backfill is video-only.
  - #4 (done this session — FCPXML). Still needs a real FCP import test to decide
    which FCP option becomes default.

---

## 7. Gotchas for whoever picks this up

- **Upstream may rewrite history again.** If a future `git fetch upstream` shows a
  "forced update" on `main` and rejected tags, the merge-base will break again.
  The recovery pattern is in this session's commits: verify the release trees are
  identical, port the diff as a `--binary` 3-way patch, then re-anchor with
  `-s ours`. (Plain `git diff` drops binary files — always use `--binary` for the
  patch.)
- **Both sides keep reinventing the same features.** Upstream independently built
  comment export and the fps fix. Before merging future upstream work, diff their
  version of our custom files against ours and keep the better one, rather than
  blindly taking theirs.
- **`fps` is load-bearing.** Marker exports convert comment times to frames with it.
  A wrong/missing fps silently shifts every timecode — this has now bitten twice
  (persistence layer, then the export endpoint). Any new export/timecode path must
  refuse to guess.
- **Tags are force-pushed.** Anyone else cloning the fork needs `--tags --force`.

---

## 8. Tooling & memory notes (this machine)

- **claude-mem** (thedotmack, v13.11.0) is installed as a Claude Code plugin —
  automatic cross-session memory, worker at `http://127.0.0.1:37777`, data in
  `~/.claude-mem`. Restart worker: `npx claude-mem restart`.
- **Curated memory** lives in `~/.claude/CLAUDE.md` (cross-project working
  prefs) and this project's memory dir (`freeframe-customizations`,
  `freeframe-working-style`, `freeframe-local-testing`).
- **`claude` CLI** (`@anthropic-ai/claude-code`) installed globally so claude-mem's
  summarizer works.
