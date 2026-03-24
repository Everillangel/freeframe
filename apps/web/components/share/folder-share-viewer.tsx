'use client'

import * as React from 'react'
import {
  Folder,
  File,
  Download,
  Search,
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Video,
  Music,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  SharePermission,
  ShareLinkAppearance,
  FolderShareAssetsResponse,
  FolderShareAssetItem,
  FolderShareSubfolder,
} from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getAssetTypeIcon(assetType: string): React.ElementType {
  switch (assetType) {
    case 'video':
      return Video
    case 'audio':
      return Music
    case 'image':
    case 'image_carousel':
      return ImageIcon
    default:
      return File
  }
}

function getAssetTypeBadgeLabel(assetType: string): string {
  switch (assetType) {
    case 'image_carousel':
      return 'Carousel'
    default:
      return assetType.charAt(0).toUpperCase() + assetType.slice(1)
  }
}

/** Grid column classes based on card_size */
function gridColsClass(cardSize: 's' | 'm' | 'l' | undefined): string {
  switch (cardSize) {
    case 's':
      return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7'
    case 'l':
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
    case 'm':
    default:
      return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
  }
}

// ─── Download handler ─────────────────────────────────────────────────────────

async function handleDownload(token: string, assetId: string, assetName: string) {
  try {
    const response = await fetch(`${API_URL}/share/${token}/stream/${assetId}`)
    if (!response.ok) return
    const data = await response.json()
    if (data?.url) {
      const a = document.createElement('a')
      a.href = data.url
      a.download = assetName
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  } catch {
    // silently fail
  }
}

// ─── Subfolder Card ───────────────────────────────────────────────────────────

interface SubfolderCardProps {
  subfolder: FolderShareSubfolder
  isDark: boolean
  accentColor: string
  aspectRatio: 'landscape' | 'square' | 'portrait'
  onClick: (subfolder: FolderShareSubfolder) => void
}

function SubfolderCard({ subfolder, isDark, accentColor, aspectRatio, onClick }: SubfolderCardProps) {
  const thumbs = subfolder.thumbnail_urls ?? []

  return (
    <button
      className={cn(
        'group flex flex-col rounded-lg border p-0 overflow-hidden text-left transition-all cursor-pointer',
        isDark
          ? 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
          : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100',
      )}
      onClick={() => onClick(subfolder)}
    >
      <div
        className={cn(
          'w-full relative overflow-hidden',
          aspectRatio === 'landscape' && 'aspect-[16/10]',
          aspectRatio === 'square' && 'aspect-square',
          aspectRatio === 'portrait' && 'aspect-[3/4]',
          isDark ? 'bg-white/[0.02]' : 'bg-zinc-100/50',
        )}
      >
        {thumbs.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Folder
              className="h-10 w-10 transition-transform group-hover:scale-110"
              style={{ color: accentColor, opacity: 0.7 }}
            />
          </div>
        ) : thumbs.length === 1 ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbs[0]}
            alt={subfolder.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className={cn(
            'absolute inset-0 grid gap-[1px]',
            thumbs.length === 2 && 'grid-cols-2',
            thumbs.length === 3 && 'grid-cols-2 grid-rows-2',
            thumbs.length >= 4 && 'grid-cols-2 grid-rows-2',
          )}>
            {thumbs.slice(0, 4).map((url, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={i}
                src={url}
                alt=""
                className={cn(
                  'h-full w-full object-cover',
                  thumbs.length === 3 && i === 0 && 'row-span-2',
                )}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ))}
          </div>
        )}

        {/* Folder icon overlay badge */}
        {thumbs.length > 0 && (
          <div className={cn(
            'absolute bottom-1.5 left-1.5 flex items-center justify-center h-6 w-6 rounded-md backdrop-blur-sm',
            isDark ? 'bg-black/50' : 'bg-white/70',
          )}>
            <Folder className="h-3.5 w-3.5" style={{ color: accentColor }} />
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <p
          className={cn(
            'text-sm font-medium truncate',
            isDark ? 'text-white' : 'text-zinc-900',
          )}
        >
          {subfolder.name}
        </p>
        <p className={cn('text-xs mt-0.5', isDark ? 'text-zinc-400' : 'text-zinc-500')}>
          {subfolder.item_count} {subfolder.item_count === 1 ? 'item' : 'items'}
        </p>
      </div>
    </button>
  )
}

// ─── Asset Grid Card ──────────────────────────────────────────────────────────

interface AssetGridCardProps {
  asset: FolderShareAssetItem
  isDark: boolean
  accentColor: string
  allowDownload: boolean
  token: string
  openInViewer: boolean
  onAssetClick?: (assetId: string) => void
  aspectRatio?: 'landscape' | 'square' | 'portrait'
  thumbnailScale?: 'fit' | 'fill'
  showCardInfo?: boolean
}

function AssetGridCard({
  asset,
  isDark,
  aspectRatio = 'landscape',
  thumbnailScale = 'fill',
  showCardInfo = true,
  accentColor,
  allowDownload,
  token,
  openInViewer,
  onAssetClick,
}: AssetGridCardProps) {
  const TypeIcon = getAssetTypeIcon(asset.asset_type)

  function handleClick() {
    if (openInViewer && onAssetClick) {
      onAssetClick(asset.id)
    }
  }

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border overflow-hidden transition-all',
        isDark
          ? 'border-white/10 bg-white/[0.03] hover:border-white/20'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm',
        openInViewer && onAssetClick ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={handleClick}
    >
      {/* Thumbnail */}
      <div
        className={cn(
          'w-full flex items-center justify-center relative',
          aspectRatio === 'landscape' && 'aspect-[16/10]',
          aspectRatio === 'square' && 'aspect-square',
          aspectRatio === 'portrait' && 'aspect-[3/4]',
          isDark ? 'bg-zinc-900' : 'bg-zinc-100',
        )}
      >
        {asset.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnail_url}
            alt={asset.name}
            className={cn(
              'h-full w-full transition-transform duration-200 group-hover:scale-[1.02]',
              thumbnailScale === 'fill' ? 'object-cover' : 'object-contain',
            )}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <TypeIcon className={cn('h-10 w-10', isDark ? 'text-zinc-600' : 'text-zinc-400')} />
        )}

        {/* Download button overlay */}
        {allowDownload && (
          <button
            className={cn(
              'absolute top-2 right-2 flex items-center justify-center h-7 w-7 rounded-md',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm',
            )}
            onClick={(e) => {
              e.stopPropagation()
              handleDownload(token, asset.id, asset.name)
            }}
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Info */}
      {showCardInfo && <div className="px-3 py-2.5 flex flex-col gap-1 min-h-[60px]">
        <p
          className={cn(
            'text-sm font-medium line-clamp-1',
            isDark ? 'text-white' : 'text-zinc-900',
          )}
        >
          {asset.name}
        </p>
        <div className="flex items-center gap-2">
          <span
            className="text-2xs px-1.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: `${accentColor}20`,
              color: accentColor,
            }}
          >
            {getAssetTypeBadgeLabel(asset.asset_type)}
          </span>
          <span className={cn('text-2xs', isDark ? 'text-zinc-500' : 'text-zinc-400')}>
            {formatFileSize(asset.file_size)}
          </span>
        </div>
      </div>}
    </div>
  )
}

// ─── Asset List Row ───────────────────────────────────────────────────────────

interface AssetListRowProps {
  asset: FolderShareAssetItem
  isDark: boolean
  accentColor: string
  allowDownload: boolean
  token: string
  openInViewer: boolean
  onAssetClick?: (assetId: string) => void
}

function AssetListRow({
  asset,
  isDark,
  accentColor,
  allowDownload,
  token,
  openInViewer,
  onAssetClick,
}: AssetListRowProps) {
  const TypeIcon = getAssetTypeIcon(asset.asset_type)

  function handleClick() {
    if (openInViewer && onAssetClick) {
      onAssetClick(asset.id)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all',
        isDark
          ? 'border-white/5 hover:border-white/10 hover:bg-white/[0.03]'
          : 'border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50',
        openInViewer && onAssetClick ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={handleClick}
    >
      {/* Small thumbnail */}
      <div
        className={cn(
          'h-10 w-14 shrink-0 rounded flex items-center justify-center overflow-hidden',
          isDark ? 'bg-zinc-800' : 'bg-zinc-100',
        )}
      >
        {asset.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnail_url}
            alt={asset.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <TypeIcon className={cn('h-4 w-4', isDark ? 'text-zinc-500' : 'text-zinc-400')} />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm font-medium truncate',
            isDark ? 'text-white' : 'text-zinc-900',
          )}
        >
          {asset.name}
        </p>
      </div>

      {/* Type badge */}
      <span
        className="text-2xs px-1.5 py-0.5 rounded-full font-medium shrink-0 hidden sm:inline"
        style={{
          backgroundColor: `${accentColor}20`,
          color: accentColor,
        }}
      >
        {getAssetTypeBadgeLabel(asset.asset_type)}
      </span>

      {/* File size */}
      <span
        className={cn(
          'text-xs w-20 text-right shrink-0 hidden md:block',
          isDark ? 'text-zinc-500' : 'text-zinc-400',
        )}
      >
        {formatFileSize(asset.file_size)}
      </span>

      {/* Date */}
      <span
        className={cn(
          'text-xs w-28 text-right shrink-0 hidden lg:block',
          isDark ? 'text-zinc-500' : 'text-zinc-400',
        )}
      >
        {formatDate(asset.created_at)}
      </span>

      {/* Download */}
      {allowDownload && (
        <button
          className={cn(
            'flex items-center justify-center h-7 w-7 rounded-md shrink-0',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            isDark
              ? 'hover:bg-white/10 text-zinc-400 hover:text-white'
              : 'hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700',
          )}
          onClick={(e) => {
            e.stopPropagation()
            handleDownload(token, asset.id, asset.name)
          }}
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ─── Section Header ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string
  count: number
  totalSize: string | null
  isDark: boolean
  expanded: boolean
  onToggle: () => void
}

function SectionHeader({ label, count, totalSize, isDark, expanded, onToggle }: SectionHeaderProps) {
  return (
    <button
      className={cn(
        'flex items-center gap-2 py-2 w-full text-left group',
      )}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          'h-4 w-4 shrink-0 transition-transform',
          !expanded && '-rotate-90',
          isDark ? 'text-zinc-500' : 'text-zinc-400',
        )}
      />
      <span
        className={cn(
          'text-xs font-semibold uppercase tracking-wider',
          isDark ? 'text-zinc-400' : 'text-zinc-500',
        )}
      >
        {count} {label}
      </span>
      {totalSize && (
        <span
          className={cn(
            'text-xs',
            isDark ? 'text-zinc-600' : 'text-zinc-400',
          )}
        >
          &middot; {totalSize}
        </span>
      )}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FolderShareViewer({
  token,
  folderName,
  title,
  description,
  permission: _permission,
  allowDownload,
  showVersions: _showVersions,
  appearance,
  branding,
  onAssetClick,
}: FolderShareViewerProps) {
  const [currentSubfolderId, setCurrentSubfolderId] = React.useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = React.useState<{ id: string; name: string }[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [foldersExpanded, setFoldersExpanded] = React.useState(true)
  const [assetsExpanded, setAssetsExpanded] = React.useState(true)

  const [assets, setAssets] = React.useState<FolderShareAssetItem[]>([])
  const [subfolders, setSubfolders] = React.useState<FolderShareSubfolder[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const isDark = appearance.theme === 'dark'
  const accentColor = appearance.accent_color ?? branding?.primary_color ?? '#6366f1'
  const cardSize = appearance.card_size
  const aspectRatio = appearance.aspect_ratio || 'landscape'
  const thumbnailScale = appearance.thumbnail_scale || 'fill'
  const showCardInfo = appearance.show_card_info !== false
  const perPage = 24

  // Compute total size of assets
  const totalAssetSize = React.useMemo(() => {
    const sum = assets.reduce((acc, a) => acc + (a.file_size ?? 0), 0)
    return sum > 0 ? formatFileSize(sum) : null
  }, [assets])

  // Fetch assets for current folder/page
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPage(1)
    setAssets([])
    setSubfolders([])

    fetch(
      `${API_URL}/share/${token}/assets?${currentSubfolderId ? `folder_id=${currentSubfolderId}&` : ''}page=1&per_page=${perPage}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load assets')
        return r.json() as Promise<FolderShareAssetsResponse>
      })
      .then((data) => {
        if (cancelled) return
        setAssets(data.assets ?? [])
        setSubfolders(data.subfolders ?? [])
        setTotal(data.total ?? 0)
        setPage(1)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load contents')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, currentSubfolderId])

  async function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const r = await fetch(
        `${API_URL}/share/${token}/assets?${currentSubfolderId ? `folder_id=${currentSubfolderId}&` : ''}page=${nextPage}&per_page=${perPage}`,
      )
      if (!r.ok) throw new Error('Failed to load more')
      const data = (await r.json()) as FolderShareAssetsResponse
      setAssets((prev) => [...prev, ...(data.assets ?? [])])
      setPage(nextPage)
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }

  function navigateToSubfolder(subfolder: FolderShareSubfolder) {
    setBreadcrumbs((prev) => [...prev, { id: subfolder.id, name: subfolder.name }])
    setCurrentSubfolderId(subfolder.id)
    setSearchQuery('')
  }

  function navigateToBreadcrumb(index: number) {
    if (index === -1) {
      // Navigate to root
      setBreadcrumbs([])
      setCurrentSubfolderId(null)
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs((prev) => prev.slice(0, index + 1))
      setCurrentSubfolderId(crumb.id)
    }
    setSearchQuery('')
  }

  // Client-side search filter
  const filteredAssets = searchQuery.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    : assets

  const filteredSubfolders = searchQuery.trim()
    ? subfolders.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    : subfolders

  const hasMore = assets.length < total && !searchQuery.trim()
  const totalItems = assets.length + subfolders.length

  // Summary line: "N Folders, N Assets"
  const summaryParts: string[] = []
  if (subfolders.length > 0) {
    summaryParts.push(`${subfolders.length} Folder${subfolders.length === 1 ? '' : 's'}`)
  }
  if (assets.length > 0) {
    summaryParts.push(`${assets.length} Asset${assets.length === 1 ? '' : 's'}`)
  }
  const summaryText = summaryParts.join(', ')

  return (
    <div
      className={cn(
        'flex-1 min-h-screen flex flex-col',
        isDark ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-900',
      )}
    >
      {/* Header */}
      <header
        className={cn(
          'sticky top-0 z-10 border-b px-5 py-4',
          isDark ? 'bg-zinc-950/95 border-white/10 backdrop-blur-sm' : 'bg-white/95 border-zinc-200 backdrop-blur-sm',
        )}
      >
        <div className="mx-auto max-w-6xl">
          {/* Brand row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              {branding?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo_url}
                  alt={branding.custom_title ?? 'Logo'}
                  className="h-7 w-auto object-contain"
                />
              ) : (
                <div
                  className="flex h-7 w-7 items-center justify-center rounded text-xs font-bold text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  FF
                </div>
              )}
              {branding?.custom_title && (
                <span
                  className={cn('text-sm font-medium', isDark ? 'text-zinc-400' : 'text-zinc-500')}
                >
                  {branding.custom_title}
                </span>
              )}
            </div>
          </div>

          {/* Title + subtitle */}
          <div className="mb-4">
            <h1
              className={cn(
                'text-xl font-bold leading-tight',
                isDark ? 'text-white' : 'text-zinc-900',
              )}
            >
              {title || folderName}
            </h1>
            {!loading && (
              <p
                className={cn(
                  'mt-1 text-sm',
                  isDark ? 'text-zinc-400' : 'text-zinc-500',
                )}
              >
                {summaryText || 'Empty folder'}
              </p>
            )}
            {description && (
              <p
                className={cn(
                  'mt-1 text-sm',
                  isDark ? 'text-zinc-500' : 'text-zinc-400',
                )}
              >
                {description}
              </p>
            )}
          </div>

          {/* Breadcrumb + Search row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
              <button
                className={cn(
                  'shrink-0 font-medium hover:underline',
                  isDark ? 'text-zinc-300 hover:text-white' : 'text-zinc-600 hover:text-zinc-900',
                  breadcrumbs.length === 0 && 'pointer-events-none',
                )}
                onClick={() => navigateToBreadcrumb(-1)}
              >
                Root
              </button>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-zinc-600' : 'text-zinc-400')}
                  />
                  <button
                    className={cn(
                      'truncate max-w-[160px] hover:underline',
                      i === breadcrumbs.length - 1
                        ? isDark
                          ? 'text-white font-medium pointer-events-none'
                          : 'text-zinc-900 font-medium pointer-events-none'
                        : isDark
                          ? 'text-zinc-300 hover:text-white'
                          : 'text-zinc-600 hover:text-zinc-900',
                    )}
                    onClick={() => navigateToBreadcrumb(i)}
                    title={crumb.name}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>

            {/* Search */}
            <div
              className={cn(
                'relative flex items-center shrink-0',
              )}
            >
              <Search
                className={cn(
                  'absolute left-2.5 h-3.5 w-3.5 pointer-events-none',
                  isDark ? 'text-zinc-500' : 'text-zinc-400',
                )}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assets…"
                className={cn(
                  'h-8 w-52 pl-8 pr-3 rounded-md text-sm border focus:outline-none',
                  isDark
                    ? 'bg-zinc-900 border-white/10 text-white placeholder:text-zinc-600 focus:border-white/20'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300',
                )}
                style={{
                  ['--tw-ring-color' as string]: accentColor,
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-6xl w-full px-5 py-6 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2
              className={cn('h-8 w-8 animate-spin', isDark ? 'text-zinc-500' : 'text-zinc-400')}
            />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <p className={cn('text-sm', isDark ? 'text-zinc-400' : 'text-zinc-500')}>{error}</p>
            </div>
          </div>
        ) : filteredSubfolders.length === 0 && filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Folder className={cn('h-12 w-12', isDark ? 'text-zinc-700' : 'text-zinc-300')} />
            <p className={cn('text-sm', isDark ? 'text-zinc-500' : 'text-zinc-400')}>
              {searchQuery.trim() ? 'No results found' : 'This folder is empty'}
            </p>
          </div>
        ) : (
          <>
            {/* Subfolders section */}
            {filteredSubfolders.length > 0 && (
              <section className="mb-6">
                <SectionHeader
                  label={filteredSubfolders.length === 1 ? 'Folder' : 'Folders'}
                  count={filteredSubfolders.length}
                  totalSize={null}
                  isDark={isDark}
                  expanded={foldersExpanded}
                  onToggle={() => setFoldersExpanded((v) => !v)}
                />
                {foldersExpanded && (
                  <div className={cn('grid gap-3 mt-2', gridColsClass(cardSize))}>
                    {filteredSubfolders.map((subfolder) => (
                      <SubfolderCard
                        key={subfolder.id}
                        subfolder={subfolder}
                        isDark={isDark}
                        accentColor={accentColor}
                        aspectRatio={aspectRatio}
                        onClick={navigateToSubfolder}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Assets section */}
            {filteredAssets.length > 0 && (
              <section>
                <SectionHeader
                  label={filteredAssets.length === 1 ? 'Asset' : 'Assets'}
                  count={filteredAssets.length}
                  totalSize={totalAssetSize}
                  isDark={isDark}
                  expanded={assetsExpanded}
                  onToggle={() => setAssetsExpanded((v) => !v)}
                />

                {assetsExpanded && (
                  <>
                    {appearance.layout === 'grid' ? (
                      <div className={cn('grid gap-3 mt-2', gridColsClass(cardSize))}>
                        {filteredAssets.map((asset) => (
                          <AssetGridCard
                            key={asset.id}
                            asset={asset}
                            isDark={isDark}
                            accentColor={accentColor}
                            allowDownload={allowDownload}
                            token={token}
                            openInViewer={appearance.open_in_viewer}
                            onAssetClick={onAssetClick}
                            aspectRatio={aspectRatio}
                            thumbnailScale={thumbnailScale}
                            showCardInfo={showCardInfo}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1 mt-2">
                        {/* List header */}
                        <div
                          className={cn(
                            'hidden lg:grid grid-cols-[1fr_100px_80px_112px_28px] gap-3 px-3 py-1.5 text-xs font-medium',
                            isDark ? 'text-zinc-500' : 'text-zinc-400',
                          )}
                        >
                          <span>Name</span>
                          <span className="text-right">Type</span>
                          <span className="text-right">Size</span>
                          <span className="text-right">Date</span>
                          {allowDownload && <span />}
                        </div>
                        {filteredAssets.map((asset) => (
                          <AssetListRow
                            key={asset.id}
                            asset={asset}
                            isDark={isDark}
                            accentColor={accentColor}
                            allowDownload={allowDownload}
                            token={token}
                            openInViewer={appearance.open_in_viewer}
                            onAssetClick={onAssetClick}
                          />
                        ))}
                      </div>
                    )}

                    {/* Load more */}
                    {hasMore && (
                      <div className="flex justify-center mt-6">
                        <button
                          onClick={loadMore}
                          disabled={loadingMore}
                          className={cn(
                            'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium border transition-colors',
                            isDark
                              ? 'border-white/10 text-zinc-300 hover:bg-white/5 hover:border-white/20 disabled:opacity-50'
                              : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50',
                          )}
                        >
                          {loadingMore ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {loadingMore ? 'Loading…' : 'Load more'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer
        className={cn(
          'border-t px-5 py-4',
          isDark ? 'border-white/10' : 'border-zinc-200',
        )}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-4 flex-wrap">
          {branding?.custom_footer ? (
            <p className={cn('text-xs', isDark ? 'text-zinc-500' : 'text-zinc-400')}>
              {branding.custom_footer}
            </p>
          ) : (
            <span />
          )}
          {!loading && (
            <p className={cn('text-xs tabular-nums', isDark ? 'text-zinc-600' : 'text-zinc-400')}>
              {searchQuery.trim()
                ? `${filteredAssets.length + filteredSubfolders.length} result${filteredAssets.length + filteredSubfolders.length === 1 ? '' : 's'}`
                : `${totalItems} item${totalItems === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}
