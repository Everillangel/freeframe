# Share Asset & Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Frame.io-style sharing for assets and folders — share link management UI, folder-level sharing, activity tracking, per-link settings, and a public folder share viewer.

**Architecture:** Extend existing ShareLink model with new fields (title, description, is_enabled, folder_id, appearance JSON), add ShareLinkActivity table for tracking, build management UI inline in project page (like trash view), and extend the public share viewer to handle folder shares with grid/list layout.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, Next.js 14, SWR, Radix UI, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-23-share-asset-folder-design.md`

---

## File Structure

### Backend — New/Modified Files

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/api/models/share.py` | Modify | Add fields to ShareLink/AssetShare, add ShareLinkActivity model |
| `apps/api/schemas/share.py` | Modify | New schemas for appearance, activity, folder shares, extended responses |
| `apps/api/routers/share.py` | Modify | PATCH endpoint, folder share endpoints, activity endpoints, fix project resolution |
| `apps/api/routers/comments.py` | Modify | Add activity logging to guest comment endpoint |
| `apps/api/services/permissions.py` | Modify | Update validate_share_link to check is_enabled |
| `apps/api/models/__init__.py` | Modify | Export ShareLinkActivity, ShareActivityAction |
| New migration file | Create | Alter share_links, alter asset_shares, create share_link_activity |

### Frontend — New/Modified Files

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/types/index.ts` | Modify | Extended ShareLink type, new ShareLinkActivity type, ShareLinkAppearance |
| `apps/web/hooks/use-share-links.ts` | Create | SWR hooks for share link CRUD + activity |
| `apps/web/components/projects/share-links-table.tsx` | Create | All Share Links table view |
| `apps/web/components/projects/share-link-detail.tsx` | Create | Share link detail + settings panel |
| `apps/web/components/projects/share-link-activity.tsx` | Create | Activity feed component |
| `apps/web/app/(dashboard)/projects/[id]/page.tsx` | Modify | Wire sidebar + share views into project page |
| `apps/web/components/share/folder-share-viewer.tsx` | Create | Folder grid viewer for public share page |
| `apps/web/app/share/[token]/page.tsx` | Modify | Add folder mode, activity logging, show_versions |

---

## Important Notes

- **ORM pattern**: This codebase uses `Mapped[T]` + `mapped_column()` (SQLAlchemy 2.0 style), NOT the legacy `Column()` style. All model code must follow this pattern.
- **Enum pattern**: Python enums use `class Foo(str, PyEnum)` where `PyEnum` is imported as `from enum import Enum as PyEnum`.
- **`allow_download` default**: The existing default is `False`. Do NOT change it to `True`.
- **Approve/reject via share link**: Endpoints `POST /share/{token}/approve` and `POST /share/{token}/reject` do NOT exist yet. Activity logging for approve/reject is deferred until those endpoints are implemented.
- **Guest comment endpoint**: Lives in `apps/api/routers/comments.py` (line 508), NOT in `routers/share.py`.
- **Task ordering**: Tasks 1-3 must be applied together before running the app, because making `asset_id` nullable breaks existing code that assumes it's non-null. The migration should be run AFTER Task 3 fixes the code.

---

## Task 1: Backend — Models, Schemas & Permission Fixes (All Together)

This task combines model changes, schema updates, and permission/endpoint fixes to ensure the app stays in a working state after the migration.

**Files:**

- Modify: `apps/api/models/share.py`
- Modify: `apps/api/models/__init__.py`
- Modify: `apps/api/schemas/share.py`
- Modify: `apps/api/services/permissions.py`
- Modify: `apps/api/routers/share.py`

### Part A: Model Changes

- [ ] **Step 1: Add new fields to ShareLink model**

In `apps/api/models/share.py`, add imports at top:

```python
from sqlalchemy import String, Enum, DateTime, ForeignKey, Boolean, func, Text, Index, JSON, CheckConstraint
```

Update `ShareLink` class — make `asset_id` nullable and add new fields after `deleted_at`:

```python
class ShareLink(Base):
    __tablename__ = "share_links"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), nullable=True, index=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("folders.id"), nullable=True, index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    permission: Mapped[SharePermission] = mapped_column(Enum(SharePermission), default=SharePermission.view)
    allow_download: Mapped[bool] = mapped_column(Boolean, default=False)
    show_versions: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    show_watermark: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    appearance: Mapped[dict] = mapped_column(JSON, nullable=False, server_default='{"layout":"grid","theme":"dark","accent_color":null,"open_in_viewer":true,"sort_by":"created_at"}')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(asset_id IS NOT NULL AND folder_id IS NULL) OR (asset_id IS NULL AND folder_id IS NOT NULL)",
            name="ck_share_link_asset_or_folder"
        ),
    )
```

- [ ] **Step 2: Add folder_id to AssetShare model**

```python
class AssetShare(Base):
    __tablename__ = "asset_shares"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), nullable=True, index=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("folders.id"), nullable=True, index=True)
    shared_with_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    shared_with_team_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    permission: Mapped[SharePermission] = mapped_column(Enum(SharePermission), default=SharePermission.view)
    shared_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(asset_id IS NOT NULL AND folder_id IS NULL) OR (asset_id IS NULL AND folder_id IS NOT NULL)",
            name="ck_asset_share_asset_or_folder"
        ),
    )
```

- [ ] **Step 3: Add ShareActivityAction enum and ShareLinkActivity model**

At the bottom of `apps/api/models/share.py`:

```python
class ShareActivityAction(str, PyEnum):
    opened = "opened"
    viewed_asset = "viewed_asset"
    commented = "commented"
    approved = "approved"
    rejected = "rejected"
    downloaded = "downloaded"

class ShareLinkActivity(Base):
    __tablename__ = "share_link_activity"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    share_link_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("share_links.id"), nullable=False, index=True)
    action: Mapped[ShareActivityAction] = mapped_column(Enum(ShareActivityAction), nullable=False)
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    asset_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_share_activity_link_created", "share_link_id", "created_at"),
    )
```

- [ ] **Step 4: Export in models/__init__.py**

Add `ShareLinkActivity, ShareActivityAction` to the imports from `.share` in `apps/api/models/__init__.py`.

### Part B: Schema Changes

- [ ] **Step 5: Add ShareLinkAppearance validator**

At the top of `apps/api/schemas/share.py`, add:

```python
from typing import Optional, Literal

class ShareLinkAppearance(BaseModel):
    layout: Literal["grid", "list"] = "grid"
    theme: Literal["dark", "light"] = "dark"
    accent_color: Optional[str] = None
    open_in_viewer: bool = True
    sort_by: Literal["name", "created_at", "file_size"] = "created_at"
```

- [ ] **Step 6: Update existing schemas for nullable asset_id**

Update `ShareLinkCreate` — add new fields (keep `allow_download` default as `False`):

```python
class ShareLinkCreate(BaseModel):
    permission: SharePermission = SharePermission.view
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    allow_download: bool = False
    title: Optional[str] = None
    description: Optional[str] = None
    show_versions: bool = True
    show_watermark: bool = False
    appearance: ShareLinkAppearance = ShareLinkAppearance()
```

Update `ShareLinkResponse` — make `asset_id` Optional, add new fields:

```python
class ShareLinkResponse(BaseModel):
    id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    token: str
    title: str
    description: Optional[str] = None
    is_enabled: bool
    permission: SharePermission
    allow_download: bool
    show_versions: bool
    show_watermark: bool
    appearance: dict
    expires_at: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}
```

Update `ShareLinkValidateResponse` — make `asset_id` Optional, add folder fields:

```python
class ShareLinkValidateResponse(BaseModel):
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    folder_name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    permission: SharePermission
    allow_download: bool
    show_versions: bool = True
    show_watermark: bool = False
    appearance: Optional[dict] = None
    requires_password: bool
```

Update `DirectShareResponse` — make `asset_id` Optional, add `folder_id`:

```python
class DirectShareResponse(BaseModel):
    id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    shared_with_user_id: Optional[uuid.UUID]
    shared_with_team_id: Optional[uuid.UUID]
    permission: SharePermission
    created_at: datetime
    model_config = {"from_attributes": True}
```

- [ ] **Step 7: Add new schemas**

```python
class ShareLinkUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    permission: Optional[SharePermission] = None
    is_enabled: Optional[bool] = None
    show_versions: Optional[bool] = None
    show_watermark: Optional[bool] = None
    appearance: Optional[ShareLinkAppearance] = None
    password: Optional[str] = None
    expires_at: Optional[datetime] = None
    allow_download: Optional[bool] = None

class ShareLinkListItem(BaseModel):
    id: uuid.UUID
    token: str
    title: str
    description: Optional[str] = None
    is_enabled: bool
    permission: SharePermission
    share_type: str  # "asset" or "folder"
    target_name: str
    view_count: int = 0
    last_viewed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

class ShareLinkActivityResponse(BaseModel):
    id: uuid.UUID
    share_link_id: uuid.UUID
    action: str
    actor_email: str
    actor_name: Optional[str] = None
    asset_id: Optional[uuid.UUID] = None
    asset_name: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}

class FolderShareAssetItem(BaseModel):
    id: uuid.UUID
    name: str
    asset_type: str
    thumbnail_url: Optional[str] = None
    file_size: Optional[int] = None
    created_at: datetime

class FolderShareSubfolder(BaseModel):
    id: uuid.UUID
    name: str
    item_count: int = 0

class FolderShareAssetsResponse(BaseModel):
    assets: list[FolderShareAssetItem]
    subfolders: list[FolderShareSubfolder]
    total: int
    page: int
    per_page: int
```

### Part C: Permission & Endpoint Fixes

- [ ] **Step 8: Update validate_share_link to check is_enabled**

In `apps/api/services/permissions.py`, update `validate_share_link` (lines 113-124):

```python
def validate_share_link(db: Session, token: str) -> ShareLink:
    """Validate a share link token and return the link. Raises 404/403/410 on failure."""
    link = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.deleted_at.is_(None),
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")
    if not link.is_enabled:
        raise HTTPException(status_code=403, detail="Share link is disabled")
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link has expired")
    return link
```

- [ ] **Step 9: Add _get_project_id_from_link helper and fix revoke endpoint**

In `apps/api/routers/share.py`, add import:

```python
from ..models.folder import Folder
```

Add helper function:

```python
def _get_project_id_from_link(db: Session, link: ShareLink) -> uuid.UUID:
    """Resolve project_id from a share link's asset or folder."""
    if link.asset_id:
        asset = _get_asset(db, link.asset_id)
        return asset.project_id
    elif link.folder_id:
        folder = db.query(Folder).filter(
            Folder.id == link.folder_id,
            Folder.deleted_at.is_(None),
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Shared folder not found")
        return folder.project_id
    raise HTTPException(status_code=400, detail="Invalid share link")
```

Update the `DELETE /share/{token}` endpoint to use `_get_project_id_from_link(db, link)` instead of `_get_asset(db, link.asset_id)`.

- [ ] **Step 10: Update GET /share/{token} to return folder info**

Update the validate endpoint to build response based on whether it's an asset or folder share. When `folder_id` is set, query the folder name and include it in the response. Include new fields: `title`, `description`, `show_versions`, `show_watermark`, `appearance`.

- [ ] **Step 11: Update POST /assets/{asset_id}/share to accept new fields**

Accept `title`, `description`, `show_versions`, `show_watermark`, `appearance` from the `ShareLinkCreate` schema. Default `title` to asset name if not provided. Store `appearance` as dict via `data.appearance.model_dump()`.

- [ ] **Step 12: Create Alembic migration and run it**

```bash
docker compose exec api alembic revision --autogenerate -m "add folder sharing and activity tracking"
```

Review the migration carefully, then:

```bash
docker compose exec api alembic upgrade head
```

- [ ] **Step 13: Commit**

```bash
git add apps/api/models/share.py apps/api/models/__init__.py apps/api/schemas/share.py apps/api/services/permissions.py apps/api/routers/share.py apps/api/alembic/versions/
git commit -m "feat: extend share models, schemas, and permissions for folder sharing"
```

---

## Task 2: Backend — New Share Link Endpoints

**Files:**

- Modify: `apps/api/routers/share.py`

- [ ] **Step 1: Add PATCH /share/{token} endpoint**

Update share link settings. Accept `ShareLinkUpdate` body. Hash password if provided (using existing bcrypt pattern). Convert appearance Pydantic model to dict. Use `model_dump(exclude_unset=True)` to only update provided fields.

Auth: resolve project via `_get_project_id_from_link`, require editor role.

- [ ] **Step 2: Add POST /folders/{folder_id}/share endpoint**

Create folder share link. Query folder, check it exists and isn't deleted. Require editor role on folder's project. Generate token with `secrets.token_urlsafe(24)`. Hash password if provided. Default title to folder name. Store appearance as dict.

- [ ] **Step 3: Add GET /folders/{folder_id}/shares endpoint**

List share links for a specific folder. Require viewer role on folder's project. Query ShareLink where `folder_id` matches and `deleted_at` is null.

- [ ] **Step 4: Add POST /folders/{folder_id}/share/user and /share/team endpoints**

Follow the exact same upsert pattern as existing `POST /assets/{asset_id}/share/user` (lines 138-188 in current routers/share.py) and `/share/team` (lines 191-227). Key differences:

- Set `folder_id` instead of `asset_id` on AssetShare
- Resolve project from folder for permission check
- Send email notification via `send_share_email.delay()`

- [ ] **Step 5: Add DELETE /folders/{folder_id}/shares/{share_id} endpoint**

Soft-delete an AssetShare record for a folder. Require editor role on folder's project.

- [ ] **Step 6: Add GET /projects/{project_id}/share-links endpoint**

List all share links in a project (both asset and folder). Use two queries (one joining Asset, one joining Folder) and union them. Support `?search=` query param for title filtering.

For view_count and last_viewed_at, use a subquery to batch-load counts instead of N+1:

```python
from sqlalchemy import func as sa_func, case

# Subquery for activity counts per share link
activity_stats = db.query(
    ShareLinkActivity.share_link_id,
    sa_func.count(case((ShareLinkActivity.action == ShareActivityAction.opened, 1))).label("view_count"),
    sa_func.max(ShareLinkActivity.created_at).label("last_viewed_at"),
).group_by(ShareLinkActivity.share_link_id).subquery()

# Join with share links
# ... build ShareLinkListItem from results
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/routers/share.py
git commit -m "feat: add share link CRUD, folder sharing, and project listing endpoints"
```

---

## Task 3: Backend — Activity Tracking & Folder Share Public Endpoints

**Files:**

- Modify: `apps/api/routers/share.py`
- Modify: `apps/api/routers/comments.py`

- [ ] **Step 1: Add _log_share_activity helper**

In `apps/api/routers/share.py`:

```python
from ..models.share import ShareLinkActivity, ShareActivityAction

def _log_share_activity(
    db: Session,
    share_link_id: uuid.UUID,
    action: ShareActivityAction,
    actor_email: str,
    actor_name: Optional[str] = None,
    asset_id: Optional[uuid.UUID] = None,
    asset_name: Optional[str] = None,
):
    activity = ShareLinkActivity(
        share_link_id=share_link_id,
        action=action,
        actor_email=actor_email,
        actor_name=actor_name,
        asset_id=asset_id,
        asset_name=asset_name,
    )
    db.add(activity)
    db.commit()
```

- [ ] **Step 2: Log "opened" on GET /share/{token}**

Add optional query param `log_open: bool = False` to the existing validate endpoint. When true, log an opened event after successful validation:

```python
if log_open:
    _log_share_activity(db, link.id, ShareActivityAction.opened, actor_email="anonymous")
```

- [ ] **Step 3: Add activity logging to guest comment endpoint**

In `apps/api/routers/comments.py`, after the guest comment is created (around line 508), import and call the activity logger:

```python
# Find the share link for this token to get share_link_id
from ..models.share import ShareLink, ShareLinkActivity, ShareActivityAction

link = db.query(ShareLink).filter(ShareLink.token == token, ShareLink.deleted_at.is_(None)).first()
if link:
    activity = ShareLinkActivity(
        share_link_id=link.id,
        action=ShareActivityAction.commented,
        actor_email=email,
        actor_name=name,
        asset_id=asset_id,
        asset_name=asset.name,
    )
    db.add(activity)
    db.commit()
```

Note: Approve/reject share endpoints don't exist yet. Activity logging for those will be added when those endpoints are implemented.

- [ ] **Step 4: Add GET /share/{token}/activity endpoint**

```python
@router.get("/share/{token}/activity", response_model=list[ShareLinkActivityResponse])
def get_share_link_activity(
    token: str,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.deleted_at.is_(None),
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    project_id = _get_project_id_from_link(db, link)
    require_project_role(db, project_id, current_user, ProjectRole.viewer)

    activities = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.share_link_id == link.id,
    ).order_by(ShareLinkActivity.created_at.desc()).offset(
        (page - 1) * per_page
    ).limit(per_page).all()

    return activities
```

- [ ] **Step 5: Add _is_descendant_of helper**

```python
def _is_descendant_of(db: Session, folder_id: uuid.UUID, ancestor_id: uuid.UUID) -> bool:
    """Check if folder_id is a descendant of ancestor_id via parent chain traversal."""
    current_id = folder_id
    visited = set()
    while current_id and current_id not in visited:
        if current_id == ancestor_id:
            return True
        visited.add(current_id)
        folder = db.query(Folder.parent_id).filter(Folder.id == current_id).first()
        current_id = folder.parent_id if folder else None
    return False
```

- [ ] **Step 6: Add GET /share/{token}/assets endpoint**

List assets in a shared folder. Public endpoint (no auth). Validate share link, check it's a folder share. Accept optional `folder_id` query param for subfolder navigation — validate it's a descendant of the shared folder. Return paginated assets + subfolders at that level.

Generate thumbnail URLs using presigned S3 URLs for each asset's latest version media file.

- [ ] **Step 7: Add GET /share/{token}/stream/{asset_id} endpoint**

Stream a specific asset from a folder share. Validate the asset belongs to the shared folder or any descendant. Generate presigned S3 URL from the asset's latest version. Log `viewed_asset` activity.

For asset shares (`link.asset_id` set), validate `asset_id` matches `link.asset_id`.

- [ ] **Step 8: Add GET /share/{token}/thumbnail/{asset_id} endpoint**

Same validation as stream endpoint. Return presigned thumbnail URL. Also add download activity logging when download is requested.

- [ ] **Step 9: Commit**

```bash
git add apps/api/routers/share.py apps/api/routers/comments.py
git commit -m "feat: add activity tracking and folder share public endpoints"
```

---

## Task 4: Frontend — Types & useShareLinks Hook

**Files:**

- Modify: `apps/web/types/index.ts`
- Create: `apps/web/hooks/use-share-links.ts`

- [ ] **Step 1: Update types/index.ts**

Update the existing `ShareLink` interface to include new fields (make `asset_id` optional, add `folder_id`, `title`, `description`, `is_enabled`, `show_versions`, `show_watermark`, `appearance`). Remove `password_hash` from the frontend type (it should never be exposed).

Add new interfaces:

```typescript
export interface ShareLinkAppearance {
  layout: "grid" | "list"
  theme: "dark" | "light"
  accent_color: string | null
  open_in_viewer: boolean
  sort_by: "name" | "created_at" | "file_size"
}

export interface ShareLinkListItem {
  id: string
  token: string
  title: string
  description: string | null
  is_enabled: boolean
  permission: SharePermission
  share_type: "asset" | "folder"
  target_name: string
  view_count: number
  last_viewed_at: string | null
}

export type ShareActivityAction = "opened" | "viewed_asset" | "commented" | "approved" | "rejected" | "downloaded"

export interface ShareLinkActivity {
  id: string
  share_link_id: string
  action: ShareActivityAction
  actor_email: string
  actor_name: string | null
  asset_id: string | null
  asset_name: string | null
  created_at: string
}

export interface FolderShareAssetItem {
  id: string
  name: string
  asset_type: string
  thumbnail_url: string | null
  file_size: number | null
  created_at: string
}

export interface FolderShareSubfolder {
  id: string
  name: string
  item_count: number
}

export interface FolderShareAssetsResponse {
  assets: FolderShareAssetItem[]
  subfolders: FolderShareSubfolder[]
  total: number
  page: number
  per_page: number
}
```

- [ ] **Step 2: Create use-share-links.ts hook**

Create `apps/web/hooks/use-share-links.ts` following the pattern from `use-folders.ts`:

```typescript
import useSWR from "swr"
import { api } from "@/lib/api"
import type { ShareLinkListItem, ShareLink, ShareLinkActivity } from "@/types"

export function useShareLinks(projectId: string) {
  const { data, mutate, isLoading } = useSWR<ShareLinkListItem[]>(
    projectId ? `/projects/${projectId}/share-links` : null,
    (key: string) => api.get<ShareLinkListItem[]>(key),
  )

  async function toggleEnabled(token: string, is_enabled: boolean) {
    await api.patch(`/share/${token}`, { is_enabled })
    mutate()
  }

  async function updateShareLink(token: string, updates: Record<string, unknown>) {
    const result = await api.patch<ShareLink>(`/share/${token}`, updates)
    mutate()
    return result
  }

  async function deleteShareLink(token: string) {
    await api.delete(`/share/${token}`)
    mutate()
  }

  async function createFolderShare(folderId: string, data: Record<string, unknown>) {
    const result = await api.post<ShareLink>(`/folders/${folderId}/share`, data)
    mutate()
    return result
  }

  async function createAssetShare(assetId: string, data: Record<string, unknown>) {
    const result = await api.post<ShareLink>(`/assets/${assetId}/share`, data)
    mutate()
    return result
  }

  return {
    shareLinks: data ?? [],
    isLoading,
    mutateShareLinks: mutate,
    toggleEnabled,
    updateShareLink,
    deleteShareLink,
    createFolderShare,
    createAssetShare,
  }
}

export function useShareLinkActivity(token: string | null) {
  const { data, isLoading } = useSWR<ShareLinkActivity[]>(
    token ? `/share/${token}/activity` : null,
    (key: string) => api.get<ShareLinkActivity[]>(key),
  )
  return { activities: data ?? [], isLoading }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/types/index.ts apps/web/hooks/use-share-links.ts
git commit -m "feat: add share link types and useShareLinks hook"
```

---

## Task 5: Frontend — Share Links Table Component

**Files:**

- Create: `apps/web/components/projects/share-links-table.tsx`

- [ ] **Step 1: Build ShareLinksTable component**

Props:

```typescript
interface ShareLinksTableProps {
  shareLinks: ShareLinkListItem[]
  onSelectLink: (token: string) => void
  onToggleEnabled: (token: string, enabled: boolean) => void
  onViewActivity: (token: string) => void
  frontendUrl: string
}
```

Layout:

- Search bar at top with magnifying glass icon: "Search for Shares"
- Client-side filter `shareLinks` by title
- Table with columns: Title, Link, Visibility, Access Type, Last Viewed, Views, Activity
- Title cell: folder icon (for `share_type === "folder"`) or file icon (for asset) + title text. Clickable — calls `onSelectLink(token)`.
- Link cell: URL chip showing `{frontendUrl}/share/{token}`. Copy button beside it.
- Visibility cell: Radix Switch — toggling calls `onToggleEnabled(token, newValue)`.
- Access Type cell: "Public" badge.
- Last Viewed cell: relative time (use `formatDistanceToNow` from date-fns or manual).
- Views cell: number.
- Activity cell: "View Activity" button — calls `onViewActivity(token)`.
- Bottom: "{N} Shares" count.
- Empty state: "No share links yet. Create one by sharing an asset or folder."

Follow existing project page styling patterns (dark theme, zinc colors, hover states).

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/projects/share-links-table.tsx
git commit -m "feat: add ShareLinksTable component"
```

---

## Task 6: Frontend — Share Link Activity Component

**Files:**

- Create: `apps/web/components/projects/share-link-activity.tsx`

- [ ] **Step 1: Build ShareLinkActivityPanel**

Props:

```typescript
interface ShareLinkActivityPanelProps {
  token: string
}
```

- Uses `useShareLinkActivity(token)` hook
- Groups events by date (e.g., "Mar 20, 2026")
- Each event row: colored initials circle (derived from actor_name first letter or actor_email) + actor name (or email if no name) + asset name (if applicable) + action label + relative timestamp
- Action labels mapped: `opened` → "Opened Share Link", `viewed_asset` → "Viewed Asset", `commented` → "Commented", `approved` → "Approved", `rejected` → "Rejected", `downloaded` → "Downloaded"
- Action label colors: green text for "Approved", red for "Rejected", default zinc for others
- Loading: skeleton rows
- Empty: "No activity yet"
- Scroll container with max height

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/projects/share-link-activity.tsx
git commit -m "feat: add ShareLinkActivityPanel component"
```

---

## Task 7: Frontend — Share Link Detail Component

**Files:**

- Create: `apps/web/components/projects/share-link-detail.tsx`

- [ ] **Step 1: Build ShareLinkDetail component**

Props:

```typescript
interface ShareLinkDetailProps {
  token: string
  projectId: string
  onBack: () => void
  frontendUrl: string
}
```

This is the most complex frontend component. It fetches the share link details via `api.get<ShareLink>(`/share/${token}`)` (authenticated version) and renders a two-panel layout.

**Left panel (main content):**

- Back button (arrow left + "All Share Links") — calls `onBack()`
- Large editable title input (auto-save on blur via `updateShareLink`)
- "Add a description..." editable text area (auto-save on blur)
- Content preview section: if folder share, fetch and show thumbnail grid of assets in folder; if asset share, show single asset thumbnail
- Item count + total size display

**Right panel (settings):**

Two tabs at top: "Settings" | "Activity"

**Settings tab** — use Radix Collapsible for each section:

1. **Link Visibility**: Switch toggle for `is_enabled` + URL display (`{frontendUrl}/share/{token}`) with copy button + clipboard icon + "Public" badge
2. **Send to**: Email input with "Share" button — calls `api.post(`/folders/${folderId}/share/user`, { email, permission })` or asset equivalent
3. **Permissions**: Three Switch toggles:
   - Comments (maps to `permission`: when off, set to `view`; when on, set to `comment`)
   - Downloads (`allow_download`)
   - Show all versions (`show_versions`)
4. **Security**:
   - Passphrase Switch + conditional password input (save on blur)
   - Expiration date: date picker input or "Not set" + clear button
   - Watermark Switch (`show_watermark`)
5. **Appearance**:
   - Layout: ToggleGroup with "Grid" and "List" options
   - Theme: ToggleGroup with moon (Dark) and sun (Light) icons
   - Accent Color: text input with `#` prefix + small color preview square
   - Open in viewer: Switch toggle
6. **Sort by**: Select dropdown with options: "Name", "Date created", "Size"

All settings auto-save: use a debounced `updateShareLink(token, updates)` call (300ms debounce).

**Activity tab**: render `<ShareLinkActivityPanel token={token} />`

**Bottom buttons:**

- "Open Share Link" button — `window.open(`${frontendUrl}/share/${token}`, '_blank')`
- "Copy Link" button — copy to clipboard + show "Copied!" flash

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/projects/share-link-detail.tsx
git commit -m "feat: add ShareLinkDetail component with settings panel"
```

---

## Task 8: Frontend — Wire Share Links into Project Page

**Files:**

- Modify: `apps/web/app/(dashboard)/projects/[id]/page.tsx`

- [ ] **Step 1: Add imports and state**

Import new components and hooks:

```typescript
import { useShareLinks } from "@/hooks/use-share-links"
import { ShareLinksTable } from "@/components/projects/share-links-table"
import { ShareLinkDetail } from "@/components/projects/share-link-detail"
```

Add state (alongside existing `showTrash`):

```typescript
const [showShareLinks, setShowShareLinks] = useState(false)
const [selectedShareLink, setSelectedShareLink] = useState<string | null>(null)
const { shareLinks, toggleEnabled, createFolderShare, mutateShareLinks } = useShareLinks(projectId)
```

- [ ] **Step 2: Replace sidebar Share Links placeholder**

Replace the "No share links yet" placeholder (around line 349) with a functional list:

- "All Share Links ({shareLinks.length})" button — on click: set `showShareLinks=true`, `selectedShareLink=null`, `showTrash=false`, `currentFolderId=null`
- Map over `shareLinks` to render each as a sidebar item with icon (folder or file) + title. On click: set `showShareLinks=true`, `selectedShareLink=link.token`
- "+" button next to "Share Links" header — opens share creation dialog

- [ ] **Step 3: Add share link views to main content area**

In the main content conditional (around line 365), add new conditions BEFORE the trash/grid conditions:

```tsx
{showShareLinks && !selectedShareLink ? (
  <ShareLinksTable
    shareLinks={shareLinks}
    onSelectLink={(token) => setSelectedShareLink(token)}
    onToggleEnabled={(token, enabled) => toggleEnabled(token, enabled)}
    onViewActivity={(token) => setSelectedShareLink(token)}
    frontendUrl={window.location.origin}
  />
) : showShareLinks && selectedShareLink ? (
  <ShareLinkDetail
    token={selectedShareLink}
    projectId={projectId}
    onBack={() => setSelectedShareLink(null)}
    frontendUrl={window.location.origin}
  />
) : showTrash ? (
  // ... existing trash view
) : (
  // ... existing asset grid
)}
```

- [ ] **Step 4: Clear share link state when switching views**

In folder click handlers, trash toggle, and collection clicks:

```typescript
setShowShareLinks(false)
setSelectedShareLink(null)
```

- [ ] **Step 5: Add "Share" option to folder context menu**

In the folder card's context menu (DropdownMenu), add a "Share" item that creates a folder share link:

```tsx
<DropdownMenuItem onClick={async () => {
  await createFolderShare(folder.id, { title: folder.name })
  // Optionally navigate to the new share link detail
}}>
  <Share2 className="h-4 w-4 mr-2" />
  Share
</DropdownMenuItem>
```

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/projects/[id]/page.tsx"
git commit -m "feat: integrate share links management into project page"
```

---

## Task 9: Frontend — Folder Share Viewer Component

**Files:**

- Create: `apps/web/components/share/folder-share-viewer.tsx`

- [ ] **Step 1: Build FolderShareViewer**

Props:

```typescript
interface FolderShareViewerProps {
  token: string
  folderName: string
  title: string
  description: string | null
  permission: SharePermission
  allowDownload: boolean
  showVersions: boolean
  appearance: ShareLinkAppearance
  branding: {
    logo_url?: string
    primary_color?: string
    custom_title?: string
    custom_footer?: string
  } | null
  onAssetClick?: (assetId: string) => void
}
```

**State:**

```typescript
const [currentSubfolderId, setCurrentSubfolderId] = useState<string | null>(null)
const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([])
const [searchQuery, setSearchQuery] = useState("")
```

**Data fetching:**

- Fetch assets via public endpoint: `GET /share/{token}/assets?folder_id=${currentSubfolderId}&page=${page}`
- No auth required (public endpoint)
- Use SWR or useState + useEffect

**Layout:**

- Apply theme class to root: `className={appearance.theme === "dark" ? "bg-zinc-950 text-white" : "bg-white text-zinc-900"}`
- Apply accent color to buttons/links via CSS custom property

**Header:**

- Branding logo (if set, from `branding.logo_url`)
- Title (from share link title)
- Description (if set)
- Breadcrumb: "Root" → subfolder names. Each clickable to navigate back.
- Search input

**Content:**

- Subfolder cards (clickable — push to breadcrumbs, update currentSubfolderId)
- Asset cards in grid or list layout (based on `appearance.layout`)
  - Grid: cards with thumbnail, name, type badge, file size
  - List: rows with thumbnail, name, type, size, date
- Click on asset: if `appearance.open_in_viewer` is true, call `onAssetClick(assetId)`
- Download button per asset if `allowDownload` is true
- Client-side search filter by asset name

**Footer:**

- Custom footer text from branding
- Item count

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/share/folder-share-viewer.tsx
git commit -m "feat: add FolderShareViewer for public folder share pages"
```

---

## Task 10: Frontend — Update Share Page for Folder Mode

**Files:**

- Modify: `apps/web/app/share/[token]/page.tsx`

- [ ] **Step 1: Update types and state**

Update the `PageState` type to add a folder mode:

```typescript
type PageState =
  | { stage: 'loading' }
  | { stage: 'password_required'; error?: string; loading?: boolean }
  | { stage: 'expired' }
  | { stage: 'invalid' }
  | { stage: 'ready'; asset: AssetResponse; permission: SharePermission; allowDownload: boolean; showVersions: boolean; branding: any }
  | { stage: 'folder_ready'; folderName: string; title: string; description: string | null; permission: SharePermission; allowDownload: boolean; showVersions: boolean; appearance: ShareLinkAppearance; branding: any }
```

Add state for viewing a single asset within a folder share:

```typescript
const [viewingAssetInFolder, setViewingAssetInFolder] = useState<string | null>(null)
```

- [ ] **Step 2: Update fetchShareInfo to handle folder responses**

Update `fetchShareInfo` to detect folder shares (when `folder_id` is present and `asset_id` is null) and return the appropriate data. On first load, append `?log_open=true` to log the opened event server-side.

Set `folder_ready` page state when the response has `folder_id`.

- [ ] **Step 3: Render FolderShareViewer**

In the main render, add the folder mode:

```tsx
{pageState.stage === 'folder_ready' && !viewingAssetInFolder && (
  <FolderShareViewer
    token={token}
    folderName={pageState.folderName}
    title={pageState.title}
    description={pageState.description}
    permission={pageState.permission}
    allowDownload={pageState.allowDownload}
    showVersions={pageState.showVersions}
    appearance={pageState.appearance}
    branding={pageState.branding}
    onAssetClick={(assetId) => setViewingAssetInFolder(assetId)}
  />
)}
```

- [ ] **Step 4: Handle single asset view within folder share**

When `viewingAssetInFolder` is set, fetch the asset's stream URL via `GET /share/{token}/stream/{assetId}` and render the existing `ShareViewer` component with a "Back to folder" button:

```tsx
{pageState.stage === 'folder_ready' && viewingAssetInFolder && (
  <div>
    <button onClick={() => setViewingAssetInFolder(null)}>
      ← Back to folder
    </button>
    {/* Render asset viewer using stream/thumbnail endpoints */}
  </div>
)}
```

- [ ] **Step 5: Add show_versions check to existing ShareViewer**

Pass `showVersions` to the existing `ShareViewer` component and conditionally hide the version switcher when false.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/share/[token]/page.tsx"
git commit -m "feat: add folder mode to public share viewer page"
```

---

## Task 11: Integration Testing & Cleanup

- [ ] **Step 1: Test backend endpoints**

Using the running dev environment:

```bash
# Create folder share link
curl -X POST http://localhost:8000/folders/{folder_id}/share \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permission":"comment","title":"Test Share"}'

# List project share links
curl http://localhost:8000/projects/{project_id}/share-links \
  -H "Authorization: Bearer $TOKEN"

# Update share link (toggle off)
curl -X PATCH http://localhost:8000/share/{token} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_enabled":false}'

# Validate disabled link (should 403)
curl http://localhost:8000/share/{token}

# Re-enable and get folder assets
curl -X PATCH http://localhost:8000/share/{token} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_enabled":true}'

curl http://localhost:8000/share/{token}/assets

# Get activity
curl http://localhost:8000/share/{token}/activity \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 2: Test frontend flows**

1. Navigate to a project page → verify "Share Links" sidebar shows existing links
2. Right-click a folder → "Share" → verify link created and appears in sidebar
3. Click "All Share Links" → verify table renders with correct data
4. Toggle visibility on a link → verify state updates
5. Click a link → verify detail/settings panel renders
6. Change appearance settings → verify auto-save
7. Click "Open Share Link" → verify folder viewer opens in new tab
8. In folder viewer: navigate subfolders, click assets to open viewer
9. Check activity tab → verify events logged
10. Test password protection flow

- [ ] **Step 3: Fix issues found during testing**

- [ ] **Step 4: Commit fixes**

```bash
git add apps/api/ apps/web/
git commit -m "fix: integration fixes for share asset and folder feature"
```
