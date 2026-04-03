# Changelog

All notable changes to FreeFrame are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-03

### Security
- **Global rate limiting** — 600 read / 300 write requests per minute per user/IP with Redis sliding window
- **Per-endpoint rate limits** on sensitive routes: magic code (5/10min), verify (10/10min), share validation (30/min), setup (3/10min)
- **Secure HLS streaming proxy** — token-authenticated manifest rewriting with directory traversal prevention
- **Cryptographic magic codes** — replaced `random.randint` with `secrets.randbelow`
- **Upload authorization hardening** — presign-part, complete, and abort endpoints now verify `created_by` ownership
- **SSE event auth** — token query param support + project membership validation (previously had no access control)
- **Share link password sessions** — 1-hour Redis sessions after password verification so users don't re-enter passwords
- **Multi-share scope enforcement** — share links only expose specifically selected items, not the entire project

### Added
- **Multi-item share links** — select multiple assets/folders and create a single share link (`ShareLinkItem` model + `POST /projects/{id}/share/multi` endpoint)
- **Add asset to existing share link** — `POST /share/{token}/add-asset/{asset_id}` endpoint with dropdown UI in the asset viewer
- **Viewer share button redesign** — dropdown with "New Share Link" + list of existing project share links
- **Inline comment editing** — edit button in comment menu opens textarea, saves via `PATCH /comments/{id}`
- **Copy comment link** — builds URL with `?commentId=` param; opens viewer and highlights the comment
- **Guest user comment flow** — name/email prompt for non-authenticated users on share links, persisted to localStorage
- **Storage indicator** — progress bar in project sidebar showing used / 10 GB with color warnings (amber 80%+, red 90%+)
- **SSE typed events** — `event: type\ndata: payload` format enabling frontend filtering via `EventSource.addEventListener`
- **SSE connection pooling** — Redis `ConnectionPool` prevents connection exhaustion under load
- **Non-blocking Celery dispatch** — background daemon thread so API never blocks on broker connections
- **Token refresh deduplication** — concurrent 401s share a single refresh call, preventing logout races
- **GitHub Actions CI** — backend tests, frontend production build, and lint on every PR
- **Dependabot** — automated weekly dependency updates for pip, npm, GitHub Actions, Docker
- **Community files** — CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, issue templates, PR template

### Fixed
- Share link viewer 403 errors — share token now flows through `ReviewProvider` → `ImageViewer` / `AudioPlayer` for stream URL fetching
- Password-protected share links — `share_session` threaded through all API calls (assets, stream, comments, thumbnails)
- Share link preview in project page showed all project assets instead of only shared items
- Comment author showing "User" instead of real name in share link sidebar
- Annotation drawing not working on shared assets (missing `AnnotationCanvas` render)
- Canvas annotations not scaling correctly — `_canvasWidth`/`_canvasHeight` stored in JSON for proper coordinate scaling
- Fabric.js not initializing on late-mounted canvas elements — re-bootstrap on drawing mode toggle
- Stale annotations persisting after comment submission — canvas and overlay now cleared
- Video player showing old video while new one loads — `streamUrl` reset to null on asset change
- Relative HLS proxy paths not resolving — API URL prepended for `/stream/hls/` paths
- Image viewer not filling container — `w-full h-full` instead of `inline-flex`
- Stub buttons wired up: Share + Download in fields panel, Assets `+` for new folder
- Right panel toggle hidden on projects listing page (not useful there)
- Main header hidden on asset viewer page (viewer has its own top bar)
- Removed non-functional "More" button from comment panel header
- Settings menu redirects to `/settings/admin` instead of `/settings/profile`
- Existing project members filtered from "Add member" suggestions
- Sidebar overflow in collapsed mode — `overflow-hidden` + `overflow-x-hidden`
- Back to Dashboard redirects to `/projects` instead of `/`
- Project detail endpoint now calculates `storage_bytes`, `asset_count`, `member_count`
- Backend `guest_comment` activity log crash when authenticated user comments via share link
- Pre-existing test failures in `test_auth` and `test_projects` (missing mock fields)
- `playheadTime` and `seekTarget` reset on asset change in review store

### Changed
- `review-store`: added `setIsDrawingMode()` for explicit control (not just toggle)

## [1.0.0] - 2026-03-27

Initial release — backend-only v1 with:
- FastAPI backend with JWT authentication and magic code login
- Org → Team → Project hierarchy with role-based permissions
- Asset upload (multipart S3), versioning, and media processing (FFmpeg → HLS, WebP, MP3)
- Comments with threading, timecode ranges, annotations (Fabric.js), and guest comments
- Approvals, sharing (links + direct), metadata fields, collections
- Branding, watermarks, notifications, SSE events
- Next.js 14 frontend with review interface, share viewer, admin panel
