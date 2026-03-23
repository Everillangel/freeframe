'use client'

import * as React from 'react'
import { X, Copy, Download, MoreHorizontal, Layers } from 'lucide-react'
import { cn, formatRelativeTime, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/shared/avatar'
import { EmptyState } from '@/components/shared/empty-state'
import { AssetCard } from './asset-card'
import { FolderCard } from './folder-card'
import { AppearancePopover } from './appearance-popover'
import { SortPopover } from './sort-popover'
import { useViewStore } from '@/stores/view-store'
import type { Asset, AssetStatus, User, Folder } from '@/types'

const statusOrder: Record<AssetStatus, number> = {
  in_review: 0,
  draft: 1,
  approved: 2,
  rejected: 3,
  archived: 4,
}

interface AssetGridProps {
  assets: Asset[]
  projectId: string
  isLoading?: boolean
  assignees?: Record<string, User>
  thumbnails?: Record<string, string>
  versionCounts?: Record<string, number>
  authorNames?: Record<string, string>
  fileSizes?: Record<string, number>
  selectedAssetId?: string | null
  onUpload?: () => void
  onAssetSelect?: (asset: Asset, e?: React.MouseEvent) => void
  onAssetOpen?: (asset: Asset) => void
  folders?: Folder[]
  currentFolderId?: string | null
  onFolderOpen?: (folder: Folder) => void
  onFolderRename?: (folderId: string, name: string) => Promise<void>
  onFolderDelete?: (folderId: string) => Promise<void>
  onFolderShare?: (folderId: string, folderName: string) => Promise<void>
  onDropToFolder?: (targetFolderId: string, assetIds: string[], folderIds: string[]) => void
  /** Actions rendered on the right side of the navigator bar */
  actions?: React.ReactNode
}

// Grid column classes based on card size
const gridColsMap = {
  S: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  M: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2',
}

// Aspect ratio classes
const aspectMap = {
  landscape: 'aspect-[16/10]',
  square: 'aspect-square',
  portrait: 'aspect-[3/4]',
}

export function AssetGrid({
  assets,
  projectId,
  isLoading = false,
  assignees = {},
  thumbnails = {},
  versionCounts = {},
  authorNames = {},
  fileSizes = {},
  selectedAssetId,
  onUpload,
  onAssetSelect,
  onAssetOpen,
  folders,
  currentFolderId,
  onFolderOpen,
  onFolderRename,
  onFolderDelete,
  onFolderShare,
  onDropToFolder,
  actions,
}: AssetGridProps) {
  const [searchQuery] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  const {
    layout,
    cardSize,
    aspectRatio,
    thumbnailScale,
    showCardInfo,
    titleLines,
    flattenFolders,
    sortKey,
    sortDirection,
  } = useViewStore()

  const toggleSelect = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const filtered = React.useMemo(() => {
    let result = [...assets]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((a) => a.name.toLowerCase().includes(q))
    }

    if (sortKey !== 'custom') {
      result.sort((a, b) => {
        let cmp = 0
        if (sortKey === 'date') {
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        } else if (sortKey === 'name') {
          cmp = a.name.localeCompare(b.name)
        } else if (sortKey === 'status') {
          cmp = statusOrder[a.status] - statusOrder[b.status]
        } else if (sortKey === 'type') {
          cmp = a.asset_type.localeCompare(b.asset_type)
        }
        return sortDirection === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [assets, searchQuery, sortKey, sortDirection])

  const showFolders = !flattenFolders && folders && folders.length > 0

  if (isLoading) {
    return (
      <div className={cn('grid gap-4', gridColsMap[cardSize])}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className={cn('animate-pulse rounded-lg bg-bg-tertiary', aspectMap[aspectRatio])} />
            <div className="h-4 w-3/4 animate-pulse rounded bg-bg-tertiary" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-bg-tertiary" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ─── Navigator Bar (Frame.io style) ─────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border pb-2.5">
        {/* Left group: Appearance + Fields + Sort */}
        <AppearancePopover />

        <div className="h-4 w-px bg-border mx-0.5" />

        <SortPopover />

        <div className="flex-1" />

        {/* Right group: action buttons passed from parent */}
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {/* ─── Folders section ────────────────────────────────────────────── */}
      {showFolders && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
              {folders!.length} {folders!.length === 1 ? 'Folder' : 'Folders'}
            </span>
          </div>
          <div className={cn('grid gap-3', gridColsMap[cardSize])}>
            {folders!.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onOpen={onFolderOpen!}
                onRename={onFolderRename}
                onDelete={onFolderDelete}
                onShare={onFolderShare}
                onDropItems={onDropToFolder}
              />
            ))}
          </div>
          {filtered.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-text-tertiary font-medium uppercase tracking-wider">
                {filtered.length} {filtered.length === 1 ? 'Asset' : 'Assets'}
              </span>
            </div>
          )}
        </>
      )}

      {/* ─── Assets ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 && !showFolders ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={Layers}
            title="No assets"
            description={searchQuery ? 'No assets match your search.' : 'Upload your first asset to get started.'}
            action={!searchQuery && onUpload ? { label: 'Upload', onClick: onUpload } : undefined}
          />
        </div>
      ) : filtered.length === 0 ? null : layout === 'grid' ? (
        <div className={cn('grid gap-3', gridColsMap[cardSize])}>
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className={cn(
                'rounded-lg transition-all cursor-pointer',
                selectedAssetId === asset.id && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
              )}
              onClick={(e) => onAssetSelect?.(asset, e)}
              onDoubleClick={() => onAssetOpen?.(asset)}
            >
              <AssetCard
                asset={asset}
                projectId={projectId}
                versionCount={versionCounts[asset.id]}
                assignee={asset.assignee_id ? assignees[asset.assignee_id] : null}
                authorName={authorNames[asset.created_by]}
                thumbnailUrl={thumbnails[asset.id]}
                selected={selectedIds.has(asset.id)}
                onSelect={() => toggleSelect(asset.id)}
                showInfo={showCardInfo}
                titleLines={titleLines}
                aspectRatio={aspectRatio}
                thumbnailScale={thumbnailScale}
                onDragStart={(e: React.DragEvent) => {
                  const ids = selectedIds.has(asset.id)
                    ? Array.from(selectedIds)
                    : [asset.id]
                  e.dataTransfer.setData(
                    'application/json',
                    JSON.stringify({ assetIds: ids, folderIds: [] }),
                  )
                  e.dataTransfer.effectAllowed = 'move'
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg-secondary/50 text-2xs text-text-tertiary font-medium uppercase tracking-wider">
            <div className="w-16 shrink-0" />
            <div className="flex-1 min-w-0">Name</div>
            <div className="hidden sm:block w-24 text-right">Size</div>
            <div className="hidden md:block w-20 text-center">Type</div>
            <div className="hidden md:block w-16 text-center">Ver.</div>
            <div className="hidden lg:block w-32">Added by</div>
            <div className="hidden sm:block w-28">Date</div>
            <div className="w-8 shrink-0" />
          </div>
          {filtered.map((asset, i) => {
            const thumb = thumbnails[asset.id]
            const assignee = asset.assignee_id ? assignees[asset.assignee_id] : null
            const fileSize = fileSizes[asset.id]
            const versionCount = versionCounts[asset.id]
            const author = authorNames[asset.created_by]
            const typeLabel = asset.asset_type === 'image_carousel' ? 'Carousel' : asset.asset_type.charAt(0).toUpperCase() + asset.asset_type.slice(1)
            return (
              <div
                key={asset.id}
                onClick={(e) => onAssetSelect?.(asset, e)}
                onDoubleClick={() => onAssetOpen?.(asset)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 transition-colors hover:bg-bg-hover cursor-pointer',
                  i !== filtered.length - 1 && 'border-b border-border',
                  selectedAssetId === asset.id ? 'bg-accent/10' : selectedIds.has(asset.id) && 'bg-accent/5',
                )}
              >
                {/* Thumbnail */}
                <div className="h-10 w-16 shrink-0 rounded bg-bg-tertiary overflow-hidden flex items-center justify-center">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={asset.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xs text-text-tertiary uppercase font-bold">{asset.asset_type}</span>
                  )}
                </div>
                {/* Name + status */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{asset.name}</p>
                  <span className={cn(
                    'inline-block text-[10px] font-medium capitalize mt-0.5 rounded px-1.5 py-0.5',
                    asset.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400'
                      : asset.status === 'rejected' ? 'bg-red-500/10 text-red-400'
                      : asset.status === 'in_review' ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-bg-tertiary text-text-tertiary',
                  )}>
                    {asset.status.replace('_', ' ')}
                  </span>
                </div>
                {/* File size */}
                <div className="hidden sm:block w-24 text-right text-xs text-text-tertiary tabular-nums">
                  {fileSize ? formatBytes(fileSize) : '—'}
                </div>
                {/* Type */}
                <div className="hidden md:block w-20 text-center">
                  <span className="text-[10px] font-medium text-text-tertiary uppercase bg-bg-tertiary rounded px-1.5 py-0.5">
                    {typeLabel}
                  </span>
                </div>
                {/* Version */}
                <div className="hidden md:block w-16 text-center text-xs text-text-tertiary tabular-nums">
                  {versionCount ? `v${versionCount}` : 'v1'}
                </div>
                {/* Author */}
                <div className="hidden lg:flex items-center gap-1.5 w-32">
                  {author ? (
                    <>
                      <Avatar name={author} size="sm" />
                      <span className="text-xs text-text-secondary truncate">{author}</span>
                    </>
                  ) : (
                    <span className="text-xs text-text-tertiary">—</span>
                  )}
                </div>
                {/* Date */}
                <div className="hidden sm:block w-28 text-xs text-text-tertiary">
                  {new Date(asset.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {/* Assignee */}
                <div className="w-8 shrink-0 flex justify-center">
                  {assignee && <Avatar src={assignee.avatar_url} name={assignee.name} size="sm" />}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bottom selection bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-20 flex items-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-2.5 shadow-xl">
          <button onClick={clearSelection} className="text-text-tertiary hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </button>
          <span className="text-sm text-text-primary font-medium">
            {selectedIds.size} asset{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="gap-1.5">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Copy className="h-4 w-4" /> Copy to
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Download className="h-4 w-4" /> Download
          </Button>
        </div>
      )}
    </div>
  )
}
