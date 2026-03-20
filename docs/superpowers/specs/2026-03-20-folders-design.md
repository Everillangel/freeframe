# Folder System Design

## Overview

Add nested folder support to projects, matching Frame.io's folder UX. Folders are a logical grouping — moving assets/folders updates a database pointer only, no S3 operations.

## Backend

### New Model: `Folder`

```python
class Folder(Base):
    __tablename__ = "folders"

    id: UUID (PK, default uuid4)
    project_id: UUID (FK → projects.id, NOT NULL, indexed)
    parent_id: UUID (FK → folders.id, nullable)  # NULL = project root
    name: str (NOT NULL)
    created_by: UUID (FK → users.id, NOT NULL)
    created_at: datetime (default utcnow)
    updated_at: datetime (default utcnow, onupdate)
    deleted_at: datetime (nullable)  # soft delete
```

Indexes: `(project_id, parent_id)` composite, `(project_id, deleted_at)`.

Constraints:
- `UNIQUE(project_id, parent_id, name)` partial index where `deleted_at IS NULL` — prevents duplicate folder names under same parent.
- **Max nesting depth: 10 levels.** Enforced on create/move by counting ancestors. Reject with 400 if exceeded.

### Asset Model Change

Add `folder_id: UUID (FK → folders.id, nullable)` to Asset. NULL = project root.

Index: `(project_id, folder_id, deleted_at)`.

Update `AssetResponse` Pydantic schema to include `folder_id: UUID | None`.

### Pydantic Schemas

```python
class FolderCreate(BaseModel):
    name: str
    parent_id: UUID | None = None

class FolderUpdate(BaseModel):
    name: str | None = None
    parent_id: UUID | None = UNSET  # use exclude_unset=True to distinguish "not sent" vs "set to null (= root)"

class FolderResponse(BaseModel):
    id: UUID
    project_id: UUID
    parent_id: UUID | None
    name: str
    created_by: UUID
    created_at: datetime
    item_count: int  # computed: immediate subfolders + assets (shallow count)

class FolderTreeNode(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None
    item_count: int
    children: list[FolderTreeNode]

class AssetMoveRequest(BaseModel):
    folder_id: UUID | None  # NULL = move to root

class BulkMoveRequest(BaseModel):
    asset_ids: list[UUID] = []
    folder_ids: list[UUID] = []
    target_folder_id: UUID | None  # NULL = root
```

Note: `item_count` is a computed field (COUNT of non-deleted subfolders + assets where parent matches), not a stored column.

### API Endpoints

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | `/projects/{id}/folders` | Create folder | editor+ |
| GET | `/projects/{id}/folders?parent_id=` | List folders in parent (NULL = root) | viewer+ |
| GET | `/projects/{id}/folder-tree` | Full tree for sidebar | viewer+ |
| PATCH | `/folders/{id}` | Rename or move (update parent_id) | editor+ |
| DELETE | `/folders/{id}` | Soft delete folder + all nested contents | editor+ |
| GET | `/projects/{id}/assets?folder_id=` | Filter assets by folder | viewer+ |
| PATCH | `/assets/{id}/move` | Move single asset to folder | editor+ |
| POST | `/projects/{id}/bulk-move` | Move multiple assets/folders at once | editor+ |
| GET | `/projects/{id}/trash` | List all soft-deleted items (paginated: skip/limit) | editor+ |
| POST | `/assets/{id}/restore` | Restore soft-deleted asset | editor+ |
| POST | `/folders/{id}/restore` | Restore folder + nested contents | editor+ |

**Folder ID query param convention**: `?folder_id={uuid}` for specific folder, `?folder_id=root` as sentinel for project root (folder_id IS NULL), omit param entirely to get all assets (backward compatible).

### Upload Schema Change

Add `folder_id: UUID | None = None` to `InitiateUploadRequest` schema. Pass through to Asset creation in the upload handler.

### Key Backend Logic

**Folder tree query**: Single query fetches all non-deleted folders for a project. Frontend builds the tree structure.

**Folder delete (cascade)**: Soft-delete the folder, then recursively soft-delete all child folders and their assets using a CTE or recursive query. Only sets `deleted_at` on folders and assets — versions, comments, and other nested entities are filtered out at query time by checking their parent asset's `deleted_at` (existing pattern).

**Folder restore**: Un-set `deleted_at` on the folder. If the parent folder is also deleted, restore to project root (simpler and avoids unintentionally restoring folders user didn't ask for). `folder_id`/`parent_id` are NOT nulled on delete — they retain original location.

**Move validation**:
- When moving a folder, check it's not being moved into itself or a descendant (prevent circular refs). Query all descendant folder IDs and reject if target is among them.
- Enforce max depth of 10 on create/move.
- For bulk move, validate ALL items belong to the same project as the URL param. Reject with 400 if any cross-project IDs are found.

**Asset listing with folder**: `GET /projects/{id}/assets` gains optional `folder_id` query param. `?folder_id=root` returns root-level assets only, `?folder_id={uuid}` returns assets in that folder, omitting the param returns all project assets (backward compatible).

**Permissions**: Folders inherit project permissions. No per-folder ACL. Existing `require_project_role` decorator works unchanged. Restore requires `editor` role (same as delete).

**Sort order**: Folders listed before assets. Both sorted by `created_at DESC` by default.

## Frontend

### Types

```typescript
interface Folder {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  created_by: string
  created_at: string
  item_count: number
}

interface FolderTreeNode {
  id: string
  name: string
  parent_id: string | null
  item_count: number
  children: FolderTreeNode[]
}

// Asset gains:
interface Asset {
  // ...existing fields
  folder_id: string | null
}
```

### Project Page Changes

**State**: Add `currentFolderId: string | null` (null = project root). Drives both sidebar highlight and grid content.

**Data fetching**:
- `GET /projects/{id}/folder-tree` — fetched once, drives sidebar
- `GET /projects/{id}/folders?parent_id={currentFolderId}` — subfolders for grid
- `GET /projects/{id}/assets?folder_id={currentFolderId}` — assets for grid

**URL**: Encode folder navigation in query params: `/projects/{id}?folder={folderId}`. Enables deep-linking and browser back/forward.

### Sidebar Folder Tree

- Recursive tree component under "Assets" section
- Project root as top node, always visible
- Expand/collapse chevrons for folders with children
- Click folder → sets `currentFolderId`, highlights in tree
- "+" button next to "Assets" header → create folder dialog
- Right-click context menu: Rename, Delete, New subfolder
- "Recently Deleted" entry at bottom with trash icon

### Main Grid Changes

**Layout** (when viewing a folder):
1. Breadcrumb bar: `Project > Folder > Subfolder` (clickable segments)
2. Subfolder section: folder cards (dark cards with folder icon, name, item count)
3. Divider with "N Assets" count
4. Asset cards (existing AssetGrid)

**Folder card**: Similar dimensions to asset card. Shows folder icon, name, "N Items" subtitle, context menu (...).

**Double-click folder card** → navigate into it (update `currentFolderId`).

**Create folder**: "+" button in toolbar opens inline rename or modal.

### Drag & Drop

**Implementation**: Native HTML5 Drag & Drop API (no extra libraries).

**Draggable sources**: Asset cards, folder cards (when selected or on drag handle).

**Drop targets**: Sidebar tree nodes, folder cards in grid, breadcrumb segments.

**Visual feedback**:
- Drop target highlights with accent border + subtle bg tint
- Drag ghost shows item count badge for multi-select: "3 items"
- Invalid targets (self, descendant) show no-drop cursor

**On drop**:
- Single item → `PATCH /assets/{id}/move` or `PATCH /folders/{id}`
- Multiple items → `POST /projects/{id}/bulk-move`
- Optimistic UI update, revert on API error

**Constraints**:
- Cannot drop folder into itself or its descendants
- Cannot drop into Recently Deleted (use delete action)

### Recently Deleted View

- Activated by clicking "Recently Deleted" in sidebar
- Flat list of all soft-deleted items (folders + assets) across the project, paginated
- Each item shows: name, type icon, original location, deleted date
- Context menu: "Restore" (no permanent delete — CLAUDE.md says never hard-delete in application code)
- Bulk restore via selection bar
- Restore puts item back to original folder if folder is alive, otherwise to project root

### Upload Integration

When uploading while viewing a folder, the new asset's `folder_id` is set to `currentFolderId`. The `InitiateUploadRequest` schema gains an optional `folder_id` field, and the upload handler passes it when creating the Asset record.

## Migration

### Alembic Migration

1. Create `folders` table with all columns and indexes
2. Add `folder_id` column to `assets` table (nullable, FK → folders.id)
3. Add composite index `(project_id, folder_id, deleted_at)` on assets
4. Add partial unique index on folders `(project_id, parent_id, name)` where `deleted_at IS NULL`

Existing assets get `folder_id = NULL` (project root) — fully backward compatible.

## Out of Scope

- Per-folder permissions / sharing
- Folder-level metadata fields
- Folder thumbnails (auto-generated from contents)
- Auto-purge of trash after 30 days (can add as Celery task later)
- Copy/duplicate folders
- Hard/permanent delete (CLAUDE.md: never hard-delete)
- SSE events for folder mutations (can add later)
- ActivityLog integration for folder operations (can add later)
