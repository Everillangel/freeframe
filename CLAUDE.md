# FreeFrame Media Platform — Claude Code Guide

Self-hostable, open-source alternative to Frame.io for production houses. Collaborative media review, annotation, and approval platform supporting images, audio, and video (up to 10GB) with org→team→project hierarchy, role-based permissions, versioning, canvas annotations, and public link sharing.

---

## Repo Structure

```
freeframe/
├── apps/
│   ├── web/              # Next.js 14 frontend (out of scope — v1 is backend only)
│   └── api/              # FastAPI backend
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── models/       # SQLAlchemy models
│       ├── schemas/      # Pydantic request/response schemas
│       ├── routers/      # API route handlers
│       ├── services/     # Business logic (auth, s3, permissions, events)
│       ├── tasks/        # Celery tasks (transcode, image, audio)
│       └── middleware/   # Auth, soft delete
├── packages/
│   └── transcoder/       # Pluggable Python transcoder package
├── docker-compose.yml    # Production
├── docker-compose.dev.yml
└── turbo.json
```

---

## Dev Commands

```bash
# Start all services (dev)
docker compose -f docker-compose.dev.yml up -d

# Run migrations
docker compose exec api alembic upgrade head

# Create new migration
docker compose exec api alembic revision --autogenerate -m "description"

# Run API tests
docker compose exec api pytest

# Celery worker (transcoding queue)
docker compose exec api celery -A tasks.celery_app worker -Q transcoding -c 2

# Turbo (monorepo)
turbo run dev       # Start all apps in dev mode
turbo run build     # Build all apps
turbo run lint      # Lint all packages
```

### Docker Services

| Service  | Port      | Description              |
|----------|-----------|--------------------------|
| web      | 3000      | Next.js frontend         |
| api      | 8000      | FastAPI backend           |
| worker   | —         | Celery transcoding worker |
| postgres | 5432      | PostgreSQL 15             |
| redis    | 6379      | Redis 7 (queue + cache)  |
| minio    | 9000/9001 | S3-compatible storage     |
| nginx    | 80/443    | Reverse proxy             |

---

## Architecture

### Hierarchy

```
Organization
└── Teams (optional grouping of members)
    └── Projects (personal or team-scoped)
        └── Assets (image, image_carousel, audio, video)
            └── AssetVersions
                └── MediaFiles
                    └── Comments / Annotations / Approvals
```

### Permission Model

Permissions are layered. Each level inherits downward:

```
Org:     owner → admin → member
Team:    lead → member
Project: owner → editor → reviewer → viewer
Share:   approve → comment → view  (per share link or AssetShare)
```

**Asset access check order:**
1. Asset creator
2. Project member (any role)
3. Directly shared via `AssetShare`
4. Shared with user's team via `AssetShare`
5. Org admin

Guest users (`GuestUser`) can comment via public share links using email + name only — no account or login required. Stored in a separate table; no mapping to real users.

### Asset Types

| Type            | Processing                        | Outputs                                     |
|-----------------|-----------------------------------|---------------------------------------------|
| `video`         | FFmpeg → multi-bitrate HLS        | HLS segments (1080p/720p/360p), thumbnail, waveform |
| `audio`         | Normalize → MP3                   | MP3, waveform JSON                          |
| `image`         | Convert → WebP                    | WebP, thumbnail                             |
| `image_carousel`| Convert each → WebP               | WebP + thumbnail per image, sequence order  |

- Max file size: **10GB**
- Upload chunk size: **10MB** (resumable via S3 multipart)
- All entities use **soft delete** (`deleted_at` column — never hard-delete in application code)

---

## Database Schema

All tables have `deleted_at: datetime | None` for soft delete.

### Core Entities

```
Organization: id, name, slug, logo_url, created_at, deleted_at

Team: id, org_id, name, description, created_at, deleted_at

User: id, email, name, avatar_url, password_hash
      status: enum(active, deactivated, pending_invite)
      created_at, deleted_at

OrgMember: id, org_id, user_id, role: enum(owner, admin, member)
           invited_by, invited_at, joined_at, deleted_at

TeamMember: id, team_id, user_id, role: enum(lead, member)
            added_at, deleted_at

Project: id, name, description, created_by, org_id
         project_type: enum(personal, team)
         team_id (nullable)
         created_at, deleted_at

ProjectMember: id, project_id, user_id
               role: enum(owner, editor, reviewer, viewer)
               invited_by, invited_at, deleted_at
```

### Asset & Media Entities

```
Asset: id, project_id, name, description
       asset_type: enum(image, image_carousel, audio, video)
       status: enum(draft, in_review, approved, rejected, archived)
       rating: int(1-5, nullable)
       assignee_id (FK→User, nullable)
       due_date (nullable)
       keywords: JSON array
       created_by, created_at, updated_at, deleted_at

AssetVersion: id, asset_id, version_number
              status: enum(uploading, processing, ready, failed)
              created_by, created_at, deleted_at

MediaFile: id, version_id, file_type: enum(image, audio, video)
           original_filename, mime_type, file_size_bytes
           s3_key_raw, s3_key_processed (HLS prefix / waveform key)
           s3_key_thumbnail
           width, height, duration_seconds, fps (nullable by type)
           sequence_order (for carousel)
           created_at

CarouselItem: id, version_id, media_file_id, position
```

### Comments & Annotations

```
Comment: id, asset_id, version_id, parent_id (nullable, for replies)
         author_id (FK→User, nullable)
         guest_author_id (FK→GuestUser, nullable)
         timecode_start: float (nullable)
         timecode_end: float (nullable, for time-range annotations)
         body, resolved, created_at, updated_at, deleted_at

Annotation: id, comment_id
            drawing_data: JSON (Fabric.js canvas)
            frame_number (video) or carousel_position (images)

GuestUser: id, email, name, created_at  (no password, no login)
```

### Approvals & Sharing

```
Approval: id, asset_id, version_id, user_id
          status: enum(approved, rejected, pending)
          note, created_at, deleted_at

ShareLink: id, asset_id, token (unique), created_by
           expires_at (nullable), password_hash (nullable)
           permission: enum(view, comment, approve)
           allow_download: bool
           created_at, deleted_at

AssetShare: id, asset_id
            shared_with_user_id (nullable)
            shared_with_team_id (nullable)
            permission: enum(view, comment, approve)
            shared_by, created_at, deleted_at
```

### Metadata & Collections

```
MetadataField: id, project_id, name
               field_type: enum(text, number, date, select, multi_select)
               options: JSON, required: bool
               created_at, deleted_at

AssetMetadata: id, asset_id, field_id, value: JSON
               created_at, updated_at

Collection: id, project_id, name, description
            filter_rules: JSON (metadata-based filter definition)
            created_by, created_at, deleted_at

CollectionShare: id, collection_id, token, permission, expires_at
                 created_by, created_at, deleted_at
```

### Comment Enhancements

```
CommentAttachment: id, comment_id
                   file_type: enum(image, video, document)
                   s3_key, original_filename, file_size_bytes
                   created_at

CommentReaction: id, comment_id, user_id, emoji: str, created_at
```

### Branding & Watermarking

```
ProjectBranding: id, project_id
                 logo_s3_key, primary_color, secondary_color
                 custom_title, custom_footer
                 viewer_layout: enum(grid, reel)
                 featured_field: str
                 created_at, updated_at

WatermarkSettings: id, project_id, share_link_id (nullable)
                   enabled: bool
                   position: enum(center, corner, tiled)
                   content: enum(email, name, custom_text)
                   custom_text (nullable), opacity: float(0-1)
                   created_at
```

### Activity, Mentions & Notifications

```
Mention: id, comment_id, mentioned_user_id, created_at

ActivityLog: id, user_id, asset_id
             action: enum(created, commented, mentioned, shared, assigned, approved, rejected)
             created_at

Notification: id, user_id, comment_id (nullable), asset_id
              type: enum(mention, assignment, due_soon, comment, approval)
              read: bool, created_at
```

---

## API Endpoints

### Auth & User Management
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register with email/password |
| POST | `/auth/login` | JWT + refresh token |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/me` | Current user profile |
| POST | `/users/invite` | Admin invites user |
| PATCH | `/users/{id}/deactivate` | Deactivate user |
| PATCH | `/users/{id}/reactivate` | Reactivate user |
| DELETE | `/users/{id}` | Soft delete user |

### Org & Team Management
| Method | Path | Description |
|--------|------|-------------|
| POST | `/organizations` | Create org |
| GET | `/organizations/{id}` | Org details |
| POST | `/organizations/{id}/members` | Add member |
| DELETE | `/organizations/{id}/members/{user_id}` | Remove member |
| POST | `/organizations/{id}/teams` | Create team |
| GET | `/organizations/{id}/teams` | List teams |
| POST | `/teams/{id}/members` | Add user to team |
| DELETE | `/teams/{id}/members/{user_id}` | Remove from team |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| POST | `/projects` | Create project (personal or team) |
| GET | `/projects` | List user's projects |
| GET | `/projects/{id}` | Project detail |
| PATCH | `/projects/{id}` | Update project |
| DELETE | `/projects/{id}` | Soft delete |
| POST | `/projects/{id}/members` | Invite member |
| PATCH | `/projects/{id}/members/{user_id}` | Change role |
| DELETE | `/projects/{id}/members/{user_id}` | Remove member |

### Upload & Assets
| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload/initiate` | Start multipart upload |
| POST | `/upload/presign-part` | Presigned URL per chunk |
| POST | `/upload/complete` | Complete upload, trigger processing |
| POST | `/upload/abort` | Abort upload |
| GET | `/projects/{id}/assets` | List assets in project |
| POST | `/projects/{id}/assets` | Create asset record |
| GET | `/assets/{id}` | Asset detail + versions |
| POST | `/assets/{id}/versions` | Upload new version |
| GET | `/assets/{id}/stream` | Presigned stream URL |
| DELETE | `/assets/{id}` | Soft delete |

### Comments & Annotations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/assets/{id}/comments` | List comments (tree) |
| POST | `/assets/{id}/comments` | Create comment (with optional timecode range + annotation) |
| PATCH | `/comments/{id}` | Edit comment |
| DELETE | `/comments/{id}` | Soft delete |
| POST | `/comments/{id}/resolve` | Mark resolved |
| POST | `/comments/{id}/replies` | Reply to comment |
| POST | `/comments/{id}/attachments` | Add attachment |
| DELETE | `/attachments/{id}` | Remove attachment |
| POST | `/comments/{id}/reactions` | Add emoji reaction |
| DELETE | `/comments/{id}/reactions/{emoji}` | Remove reaction |
| GET | `/comments/{id}/link` | Shareable deep link to comment |

### Approvals & Sharing
| Method | Path | Description |
|--------|------|-------------|
| POST | `/assets/{id}/approve` | Approve version |
| POST | `/assets/{id}/reject` | Reject with note |
| GET | `/assets/{id}/approvals` | Approval status per reviewer |
| POST | `/assets/{id}/share` | Create share link |
| POST | `/assets/{id}/share/user` | Share directly to user |
| POST | `/assets/{id}/share/team` | Share to team |
| GET | `/share/{token}` | Validate public link |
| POST | `/share/{token}/comment` | Guest comment (requires email + name) |

### Asset Discovery
| Method | Path | Description |
|--------|------|-------------|
| GET | `/me/assets` | All accessible assets |
| GET | `/me/assets?filter=owned` | Only owned |
| GET | `/me/assets?filter=shared` | Only shared with me |
| GET | `/me/assets?filter=mentioned` | Only where mentioned |
| GET | `/me/assets?filter=assigned` | Assigned to me |
| GET | `/me/assets?filter=due_soon` | Due within 7 days |

### Metadata & Collections
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/projects/{id}/metadata-fields` | List / create custom fields |
| PATCH/DELETE | `/metadata-fields/{id}` | Update / delete field |
| PATCH | `/assets/{id}/metadata` | Update built-in + custom metadata |
| GET/POST | `/projects/{id}/collections` | List / create collection |
| GET/PATCH/DELETE | `/collections/{id}` | Get / update / delete collection |
| POST | `/collections/{id}/share` | Share collection |

### Branding & Watermarks
| Method | Path | Description |
|--------|------|-------------|
| GET/PATCH | `/projects/{id}/branding` | Get / update branding |
| POST | `/projects/{id}/branding/logo` | Upload logo |
| GET/PATCH | `/projects/{id}/watermark` | Get / update watermark settings |
| PATCH | `/share/{token}/watermark` | Override watermark for share link |

### Assignments & Notifications
| Method | Path | Description |
|--------|------|-------------|
| POST | `/assets/{id}/assign` | Assign reviewer (+ optional due date) |
| DELETE | `/assets/{id}/assign/{user_id}` | Unassign user |
| GET | `/me/notifications` | List notifications |
| PATCH | `/notifications/{id}/read` | Mark as read |
| PATCH | `/notifications/read-all` | Mark all read |

### Org Admin Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/org/{id}/stats` | Total users, teams, projects, storage |
| GET | `/admin/org/{id}/users` | All users with status, role, last active |
| GET | `/admin/org/{id}/users/{user_id}/activity` | User activity log |
| GET | `/admin/org/{id}/teams` | Teams with member/project counts |
| GET | `/admin/org/{id}/projects` | All projects with storage sizes |
| GET | `/admin/org/{id}/storage` | Storage breakdown by team/user/project |
| GET | `/admin/org/{id}/audit-log` | User actions, logins, permission changes |
| POST | `/admin/org/{id}/users/bulk-invite` | Bulk invite via CSV/email list |
| POST | `/admin/org/{id}/users/bulk-deactivate` | Bulk deactivate |
| PATCH | `/admin/org/{id}/settings` | Org settings (name, logo, defaults) |

### SSE Events

Single endpoint per project: `GET /events/{project_id}`

```
transcode_progress  → {asset_id, percent}
transcode_complete  → {asset_id, version_id}
transcode_failed    → {asset_id, error}
new_comment         → {asset_id, comment_id, author}
comment_resolved    → {comment_id}
approval_updated    → {asset_id, user_id, status}
```

No WebSockets — SSE only. Clients reconnect automatically on disconnect.

---

## Media Processing Pipeline

### Video (FFmpeg → HLS)
1. Download raw file from S3 → `/tmp/{version_id}/input`
2. `ffprobe` → extract metadata (duration, fps, width, height)
3. FFmpeg multi-bitrate HLS: 1080p (CRF 20), 720p (CRF 22), 360p (CRF 26), 2-second segments, forced keyframes every 2s
4. Generate thumbnails (1 per 10s)
5. Generate waveform JSON
6. Upload all to S3 `hls/{project_id}/{version_id}/`
7. Update status → `ready`, push SSE `transcode_complete`

### Audio (Normalize → MP3)
- Input: MP3, WAV, FLAC, AAC, etc.
- Output: Normalized MP3 + waveform JSON
- No HLS — direct streaming

### Image (Convert → WebP)
- Input: JPEG, PNG, WebP, HEIC, TIFF, etc.
- Output: Optimized WebP + thumbnail
- Carousel: process each image independently, store sequence order

### Watermark Burning
- Dynamic watermark: burn user email/name into frames at share time (not stored)
- Position: center / corner (all 4) / tiled
- Opacity: configurable (default 30%)
- Video: FFmpeg drawtext filter; Images: ImageMagick

### S3 Content-Type Headers

```python
".m3u8": ContentType="application/vnd.apple.mpegurl", CacheControl="no-cache"
".ts":   ContentType="video/mp2t",                    CacheControl="max-age=31536000"
".jpg":  ContentType="image/jpeg",                    CacheControl="max-age=86400"
".webp": ContentType="image/webp",                    CacheControl="max-age=86400"
".mp3":  ContentType="audio/mpeg",                    CacheControl="max-age=86400"
".json": ContentType="application/json",              CacheControl="max-age=86400"
```

---

## Key Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Max file size | 10GB | Supports 4K raw footage |
| Chunk size | 10MB | Balance between request count and resume granularity |
| Video output | HLS (2s segments) | Frame-accurate seeking |
| Audio output | MP3 + waveform JSON | Universal playback + visualization |
| Image output | WebP + thumbnail | Optimized size, broad browser support |
| Annotations | Fabric.js JSON per comment | Lightweight, no extra service |
| Soft delete | `deleted_at` on all entities | Recoverable, audit trail |
| Guest users | Separate `GuestUser` table | No conflict with real user accounts |
| Real-time | SSE (no WebSockets) | Sufficient for async review workflow |
| Transcoder | Pluggable (FFmpeg default) | Works self-hosted; swap to MediaConvert in cloud |
| Auth | JWT (15min) + refresh tokens (7d) | Stateless; compatible with share link guests |
| Storage | MinIO (dev) / S3 (prod) | Identical S3 API; user controls infrastructure |

---

## Environment Variables

**`apps/api/.env`**
```
DATABASE_URL=postgresql://user:pass@postgres:5432/freeframe
REDIS_URL=redis://redis:6379/0
S3_BUCKET=freeframe
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
JWT_SECRET=your-secret-key
FRONTEND_URL=http://localhost:3000
TRANSCODER_ENGINE=ffmpeg
```

**`apps/web/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXTAUTH_SECRET=your-secret
NEXTAUTH_URL=http://localhost:3000
```

---

## Implementation Order (v1 Backend)

1. Project scaffold (Turborepo, FastAPI, Docker Compose)
2. Database models + Alembic migrations + seed script
3. Auth & user management (JWT, invite, deactivate)
4. Org, team, project APIs
5. Permission service + middleware
6. Upload & S3 service (multipart, presign, resume)
7. Media processing (video → HLS, audio → MP3, image → WebP, Celery tasks)
8. Asset & version APIs + stream URLs + asset discovery
9. Comments & annotations (threading, timecode range, guest comments, mentions)
10. Approvals & sharing (share links, direct user/team sharing)
11. Metadata & collections (custom fields, smart collections, collection sharing)
12. Comment enhancements (attachments, emoji reactions, deep links)
13. Branding & watermarks (project branding, dynamic watermark burning)
14. Assignments & notifications (due dates, notification API, due-date reminders)
15. Soft delete middleware + activity logging + cascade delete
16. Tests (pytest) + OpenAPI docs + README
17. **Email service (SES + SMTP) with async Celery queues**
18. **Magic code auth flow with Redis storage**
19. **Super admin role + first-time setup onboarding**
20. **Streaming video transcoding (presigned URLs, no full download)**

---

## Recent Additions (Post v1 Core)

### Email Service

- **Provider support**: AWS SES or any SMTP server (configurable via `MAIL_PROVIDER`)
- **Async queues**: Celery workers with `email_high` (magic codes, invites) and `email_low` (notifications)
- **Templates**: Jinja2 HTML templates for all email types
- **Rate limiting**: 10 emails/second to avoid SES throttling

### Magic Code Authentication

- **Flow**: Email → 6-digit code → Verify → Set password (if new user)
- **Storage**: Redis with 10-minute TTL
- **Endpoints**: `/auth/send-magic-code`, `/auth/verify-magic-code`, `/auth/set-password`

### Super Admin & Setup

- **First user**: Automatically becomes super admin via `/setup/create-superadmin`
- **Org creation**: Restricted to super admins only
- **Setup check**: `GET /setup/status` returns `needs_setup: true/false`

### Streaming Transcoding

- **No full download**: FFmpeg reads directly from presigned S3 URL
- **Disk usage**: Reduced from 3x to 1x file size
- **Large files**: Supports 10GB+ videos with 4-hour timeout
- **Configurable**: `TRANSCODING_CONCURRENCY` and `EMAIL_CONCURRENCY` env vars

---

## Frontend Development Guide

### Priority 1: Setup & Auth

| Page | Route | API Endpoints |
|------|-------|---------------|
| Setup Wizard | `/setup` | `GET /setup/status`, `POST /setup/create-superadmin` |
| Login | `/login` | `POST /auth/send-magic-code`, `POST /auth/verify-magic-code` |
| Set Password | `/login` (step 3) | `POST /auth/set-password` |
| Accept Invite | `/invite/[token]` | `GET /auth/invite/{token}`, `POST /auth/accept-invite` |

### Priority 2: Admin & Org

| Page | Route | API Endpoints |
|------|-------|---------------|
| Super Admin | `/admin` | `POST /organizations`, user management |
| Org Dashboard | `/org/[id]` | `GET /organizations/{id}`, member management |
| Projects | `/org/[id]/projects` | `GET /projects`, `POST /projects` |

### User Model (Frontend)

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  status: "active" | "deactivated" | "pending_invite" | "pending_verification";
  is_superadmin: boolean;
  email_verified: boolean;
}
```

### Auth Flow Logic

```typescript
// On app load
const { needs_setup } = await fetch('/setup/status');
if (needs_setup) redirect('/setup');

// Login flow
const { needs_password } = await verifyMagicCode(email, code);
if (needs_password) showSetPasswordForm();
else redirect('/dashboard');

// Protected routes
const user = await fetch('/auth/me');
if (user.is_superadmin) showAdminMenu();
```

---

## v1 Out of Scope

- Frontend (Next.js) — separate phase after backend complete
- Mobile apps
- Real-time collaboration (cursor sync)
- AI features (transcription, scene detection)
- SSO / SAML
- Billing / subscriptions
- NLE plugins (Premiere, Final Cut, Resolve)
- Camera to Cloud (C2C) integration
