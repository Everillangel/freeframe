'use client'

import * as React from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Upload, Users, ChevronRight, X, FolderOpen,
  Link as LinkIcon, Download, Filter, Share2, Plus,
  Trash2, ChevronDown, MessageSquare, Info, Settings,
  FolderPlus, Folder as FolderIcon,
} from 'lucide-react'
import { cn, formatRelativeTime, formatBytes } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/shared/avatar'
import { AssetGrid } from '@/components/projects/asset-grid'
import { CommentPanel } from '@/components/review/comment-panel'
import { UploadZone } from '@/components/upload/upload-zone'
import { useUploadStore } from '@/stores/upload-store'
import { useAuthStore } from '@/stores/auth-store'
import { useComments } from '@/hooks/use-comments'
import { useFolders, useTrash } from '@/hooks/use-folders'
import { FolderTree } from '@/components/projects/folder-tree'
import { FolderBreadcrumb } from '@/components/projects/folder-breadcrumb'
import type { Project, AssetResponse, ProjectMember, User, Collection, Folder } from '@/types'

// ─── Collection icon colors (Frame.io style) ──────────────────────────────────
const collectionIcons: Record<string, { icon: string; color: string }> = {
  'needs review': { icon: '👀', color: 'text-yellow-400' },
  'audio': { icon: '🎵', color: 'text-blue-400' },
  'images': { icon: '🖼️', color: 'text-pink-400' },
  'videos': { icon: '🎬', color: 'text-purple-400' },
  'approved': { icon: '🎉', color: 'text-green-400' },
}

function getCollectionIcon(name: string) {
  const lower = name.toLowerCase()
  for (const [key, val] of Object.entries(collectionIcons)) {
    if (lower.includes(key)) return val
  }
  return { icon: '📁', color: 'text-text-tertiary' }
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = params.id as string

  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [assetName, setAssetName] = React.useState('')
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([])
  const [selectedAsset, setSelectedAsset] = React.useState<AssetResponse | null>(null)
  const [collectionsExpanded, setCollectionsExpanded] = React.useState(true)
  const [shareLinksExpanded, setShareLinksExpanded] = React.useState(true)
  const [rightTab, setRightTab] = React.useState<'comments' | 'fields'>('comments')

  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(
    searchParams.get('folder') || null
  )
  const [showTrash, setShowTrash] = React.useState(false)

  const { files: uploadFiles, startUpload } = useUploadStore()
  const { user } = useAuthStore()

  const {
    tree,
    mutateTree,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    moveAsset,
    bulkMove,
    restoreAsset,
    restoreFolder,
  } = useFolders(projectId)

  const { trash, mutateTrash } = useTrash(projectId)

  // Comments for the selected asset
  const selectedVersionId = selectedAsset?.latest_version?.id || null
  const {
    comments,
    resolveComment,
    deleteComment,
    addReaction,
    removeReaction,
  } = useComments(selectedAsset?.id || null, selectedVersionId)

  const { data: project, isLoading: loadingProject } = useSWR<Project>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  )

  const folderParam = currentFolderId ? `folder_id=${currentFolderId}` : 'folder_id=root'
  const { data: assets, isLoading: loadingAssets, mutate: mutateAssets } = useSWR<AssetResponse[]>(
    showTrash ? null : `/projects/${projectId}/assets?${folderParam}`,
    (key: string) => api.get<AssetResponse[]>(key),
  )

  // Subfolders for current view
  const { data: subfolders } = useSWR<Folder[]>(
    showTrash ? null : `/projects/${projectId}/folders?parent_id=${currentFolderId ?? 'root'}`,
    (key: string) => api.get<Folder[]>(key),
  )

  const { data: collections } = useSWR<Collection[]>(
    `/projects/${projectId}/collections`,
    () => api.get<Collection[]>(`/projects/${projectId}/collections`),
  )

  const thumbnails = React.useMemo(() => {
    if (!assets) return {}
    const map: Record<string, string> = {}
    for (const a of assets) {
      if (a.thumbnail_url) map[a.id] = a.thumbnail_url
    }
    return map
  }, [assets])

  const versionCounts = React.useMemo(() => {
    if (!assets) return {}
    const map: Record<string, number> = {}
    for (const a of assets) {
      if (a.latest_version) map[a.id] = a.latest_version.version_number
    }
    return map
  }, [assets])

  const { data: members } = useSWR<ProjectMember[]>(
    `/projects/${projectId}/members`,
    () => api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  )

  const assigneeIds = React.useMemo(() => {
    if (!assets) return []
    const ids = assets.map((a) => a.assignee_id).filter(Boolean) as string[]
    return Array.from(new Set(ids))
  }, [assets])

  const { data: assigneeUsers } = useSWR<User[]>(
    assigneeIds.length > 0 ? `/users?ids=${assigneeIds.join(',')}` : null,
    () => api.get<User[]>(`/users?ids=${assigneeIds.join(',')}`),
  )

  const assigneesMap: Record<string, User> = React.useMemo(() => {
    if (!assigneeUsers) return {}
    return Object.fromEntries(assigneeUsers.map((u) => [u.id, u]))
  }, [assigneeUsers])

  React.useEffect(() => {
    const anyComplete = uploadFiles.some(
      (f) => f.projectId === projectId && f.status === 'complete',
    )
    if (anyComplete) mutateAssets()
  }, [uploadFiles, mutateAssets, projectId])

  const handleFilesSelected = (files: File[]) => {
    setPendingFiles(files)
    if (files.length > 0) setAssetName(files[0].name.replace(/\.[^/.]+$/, ''))
  }

  const handleStartUpload = () => {
    pendingFiles.forEach((file) => {
      const name = pendingFiles.length === 1 ? assetName || file.name : file.name
      // Note: startUpload does not yet accept folderId — assets will upload to root.
      // Upload store needs to be updated in a future task to support folder placement.
      startUpload(file, projectId, name, project?.name, currentFolderId)
    })
    setPendingFiles([])
    setAssetName('')
    setUploadOpen(false)
  }

  const handleSelectFolder = React.useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId)
    setShowTrash(false)
    const url = folderId
      ? `/projects/${projectId}?folder=${folderId}`
      : `/projects/${projectId}`
    window.history.replaceState(null, '', url)
  }, [projectId])

  return (
    <div className="flex h-full flex-col lg:flex-row overflow-hidden">
      {/* ─── Left Sidebar (Frame.io style) ──────────────────────────────── */}
      <div className="hidden lg:flex w-72 flex-col border-r border-border bg-bg-secondary shrink-0">
        {/* Assets section */}
        <div className="p-3 space-y-0.5">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">Assets</span>
            <button className="text-text-tertiary hover:text-text-primary transition-colors">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Project folder tree */}
          <FolderTree
            tree={tree}
            projectName={project?.name || 'Project'}
            currentFolderId={currentFolderId}
            showTrash={showTrash}
            onSelectFolder={handleSelectFolder}
            onShowTrash={() => { setShowTrash(true); setCurrentFolderId(null) }}
            onCreateFolder={async (name, parentId) => {
              await createFolder(name, parentId)
              mutateAssets()
            }}
            onRenameFolder={renameFolder}
            onDeleteFolder={async (id) => {
              await deleteFolder(id)
              if (currentFolderId === id) handleSelectFolder(null)
              mutateAssets()
            }}
            onDropItems={async (targetFolderId, assetIds, folderIds) => {
              await bulkMove(assetIds, folderIds, targetFolderId)
              mutateAssets()
            }}
          />
        </div>

        {/* Collections section */}
        <div className="px-3 py-2 border-t border-border">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span
              className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider cursor-pointer"
              onClick={() => setCollectionsExpanded(!collectionsExpanded)}
            >
              Collections
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation() }}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setCollectionsExpanded(!collectionsExpanded)}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', !collectionsExpanded && '-rotate-90')} />
              </button>
            </div>
          </div>

          {collectionsExpanded && (
            <div className="space-y-0.5">
              {collections && collections.length > 0 ? (
                collections.map((c) => {
                  const { icon } = getCollectionIcon(c.name)
                  return (
                    <Link
                      key={c.id}
                      href={`/projects/${projectId}/collections?id=${c.id}`}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                    >
                      <span className="text-sm">{icon}</span>
                      <span className="truncate">{c.name}</span>
                    </Link>
                  )
                })
              ) : null}
              <Link
                href={`/projects/${projectId}/collections`}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>New Collection</span>
              </Link>
            </div>
          )}
        </div>

        {/* Share Links section */}
        <div className="px-3 py-2 border-t border-border">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span
              className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider cursor-pointer"
              onClick={() => setShareLinksExpanded(!shareLinksExpanded)}
            >
              Share Links
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation() }}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShareLinksExpanded(!shareLinksExpanded)}
                className="text-text-tertiary hover:text-text-primary transition-colors"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', !shareLinksExpanded && '-rotate-90')} />
              </button>
            </div>
          </div>

          {shareLinksExpanded && (
            <div className="px-2 py-2 text-xs text-text-tertiary">
              No share links yet
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Storage */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center justify-between text-2xs text-text-tertiary mb-1.5">
            <span>Storage</span>
            <span>{assets ? formatBytes(assets.length * 1024 * 1024 * 5) : '0 B'}</span>
          </div>
          <div className="h-1 w-full bg-bg-tertiary rounded-full overflow-hidden">
            <div className="h-full bg-accent w-1/12" />
          </div>
        </div>
      </div>

      {/* ─── Main Content ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg-primary h-full overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-4">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Link href="/projects" className="hover:text-text-primary transition-colors">Projects</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-text-secondary">{loadingProject ? '...' : project?.name}</span>
          </nav>

          {/* Header row: project name + members + actions */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-text-primary">
                {loadingProject ? '...' : project?.name}
              </h1>
              {/* Member avatars */}
              {members && members.length > 0 && (
                <button className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 hover:bg-bg-hover transition-colors">
                  <Users className="h-3 w-3 text-text-tertiary" />
                  <span className="text-2xs text-text-secondary">{members.length}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm">
                <Share2 className="h-4 w-4" />
                Share
              </Button>

              <button
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[13px] transition-colors"
                onClick={async () => {
                  const name = prompt('Folder name:')
                  if (name) {
                    await createFolder(name, currentFolderId)
                    mutateAssets()
                  }
                }}
              >
                <FolderPlus className="h-4 w-4" />
                New Folder
              </button>

              <Dialog.Root open={uploadOpen} onOpenChange={setUploadOpen}>
                <Dialog.Trigger asChild>
                  <Button size="sm">
                    <Upload className="h-4 w-4" />
                    Upload
                  </Button>
                </Dialog.Trigger>

                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                  <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                    <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
                      <X className="h-4 w-4" />
                    </Dialog.Close>
                    <Dialog.Title className="text-base font-semibold text-text-primary">Upload asset</Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-text-secondary">Add new media to this project.</Dialog.Description>
                    <div className="mt-4 space-y-4">
                      {pendingFiles.length === 0 ? (
                        <UploadZone onFilesSelected={handleFilesSelected} />
                      ) : (
                        <>
                          <div className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary">
                            {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected:{' '}
                            {pendingFiles.map((f) => f.name).join(', ')}
                          </div>
                          {pendingFiles.length === 1 && (
                            <Input label="Asset name" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Hero Video Final" />
                          )}
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" size="sm" onClick={() => setPendingFiles([])}>Change files</Button>
                            <Button size="sm" onClick={handleStartUpload}>Start upload</Button>
                          </div>
                        </>
                      )}
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          </div>

          {/* Folder breadcrumb */}
          <FolderBreadcrumb
            projectName={project?.name || 'Project'}
            currentFolderId={currentFolderId}
            tree={tree}
            onNavigate={handleSelectFolder}
            onDropItems={async (targetFolderId, assetIds, folderIds) => {
              await bulkMove(assetIds, folderIds, targetFolderId)
              mutateAssets()
            }}
          />

          {/* Asset grid or Trash view */}
          {showTrash ? (
            <div className="flex-1 overflow-y-auto">
              <h2 className="text-sm font-medium text-text-primary mb-3">Recently Deleted</h2>
              {trash.folders.length === 0 && trash.assets.length === 0 ? (
                <p className="text-xs text-text-tertiary">No deleted items</p>
              ) : (
                <div className="space-y-1">
                  {trash.folders.map((item) => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderIcon className="h-4 w-4 text-text-tertiary shrink-0" />
                        <span className="text-sm text-text-primary truncate">{item.name}</span>
                        <span className="text-xs text-text-tertiary">Folder</span>
                      </div>
                      <button
                        className="text-xs text-accent hover:underline shrink-0"
                        onClick={async () => {
                          await restoreFolder(item.id)
                          mutateTrash()
                          mutateAssets()
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                  {trash.assets.map((item) => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-text-primary truncate">{item.name}</span>
                        <span className="text-xs text-text-tertiary capitalize">{item.type}</span>
                      </div>
                      <button
                        className="text-xs text-accent hover:underline shrink-0"
                        onClick={async () => {
                          await restoreAsset(item.id)
                          mutateTrash()
                          mutateAssets()
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <AssetGrid
              assets={assets ?? []}
              folders={subfolders ?? []}
              currentFolderId={currentFolderId}
              projectId={projectId}
              isLoading={loadingAssets}
              assignees={assigneesMap}
              thumbnails={thumbnails}
              versionCounts={versionCounts}
              selectedAssetId={selectedAsset?.id}
              onUpload={() => setUploadOpen(true)}
              onAssetSelect={(asset) => setSelectedAsset(asset as AssetResponse)}
              onAssetOpen={(asset) => router.push(`/projects/${projectId}/assets/${asset.id}`)}
              onFolderOpen={(folder) => handleSelectFolder(folder.id)}
              onFolderRename={renameFolder}
              onFolderDelete={async (id) => {
                await deleteFolder(id)
                mutateAssets()
              }}
              onDropToFolder={async (targetFolderId, assetIds, folderIds) => {
                await bulkMove(assetIds, folderIds, targetFolderId)
                mutateAssets()
              }}
            />
          )}
        </div>
      </div>

      {/* ─── Right Panel (Comments + Fields tabs) ───────────────────────── */}
      <div className="hidden xl:flex w-[360px] flex-col border-l border-border bg-bg-secondary shrink-0">
        {/* Tabs */}
        <div className="flex items-center border-b border-border">
          <button
            onClick={() => setRightTab('comments')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2',
              rightTab === 'comments'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Comments
          </button>
          <button
            onClick={() => setRightTab('fields')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2',
              rightTab === 'fields'
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            Fields
          </button>
          {selectedAsset && (
            <button
              onClick={() => setSelectedAsset(null)}
              className="px-3 text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {selectedAsset ? (
          rightTab === 'comments' ? (
            /* Comments tab — real comments */
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {comments.length > 0 ? (
                <CommentPanel
                  comments={comments as any}
                  currentUserId={user?.id}
                  onResolve={resolveComment}
                  onDelete={deleteComment}
                  onAddReaction={addReaction}
                  onRemoveReaction={removeReaction}
                  onReply={() => {}}
                  onSubmitReply={async () => {}}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                  <div>
                    <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-bg-tertiary flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-text-tertiary/50" />
                    </div>
                    <p className="text-sm text-text-secondary">No comments yet</p>
                    <p className="text-xs text-text-tertiary mt-1">Double-click the asset to open the viewer and leave comments.</p>
                  </div>
                </div>
              )}
              {/* Quick link to open in viewer */}
              <div className="border-t border-border p-3 shrink-0">
                <Link href={`/projects/${projectId}/assets/${selectedAsset.id}`}>
                  <div className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-tertiary cursor-pointer hover:border-border-focus transition-colors text-center">
                    Open in viewer to comment
                  </div>
                </Link>
              </div>
            </div>
          ) : (
            /* Fields tab */
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Thumbnail preview */}
              <div className="aspect-video bg-bg-tertiary rounded-lg overflow-hidden border border-border flex items-center justify-center">
                {selectedAsset.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedAsset.thumbnail_url} alt={selectedAsset.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-text-tertiary uppercase font-bold">{selectedAsset.asset_type}</span>
                )}
              </div>

              <h4 className="text-sm font-semibold text-text-primary break-words">{selectedAsset.name}</h4>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Type</span>
                  <span className="text-xs text-text-primary capitalize">{selectedAsset.asset_type.replace('_', ' ')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">Uploaded</span>
                  <span className="text-xs text-text-primary">{formatRelativeTime(selectedAsset.created_at)}</span>
                </div>
                {selectedAsset.latest_version && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">Version</span>
                    <span className="text-xs text-text-primary">v{selectedAsset.latest_version.version_number}</span>
                  </div>
                )}
                {selectedAsset.assignee_id && assigneesMap[selectedAsset.assignee_id] && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">Assignee</span>
                    <div className="flex items-center gap-1.5">
                      <Avatar size="sm" className="h-5 w-5" />
                      <span className="text-xs text-text-primary">{assigneesMap[selectedAsset.assignee_id].name}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-border grid grid-cols-2 gap-2">
                <Button asChild className="w-full col-span-2" size="sm">
                  <Link href={`/projects/${projectId}/assets/${selectedAsset.id}`}>Open in Player</Link>
                </Button>
                <Button variant="secondary" size="sm" className="gap-1">
                  <LinkIcon className="h-3.5 w-3.5" /> Share
                </Button>
                <Button variant="secondary" size="sm" className="gap-1">
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          )
        ) : (
          /* No asset selected */
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div>
              <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-bg-tertiary flex items-center justify-center">
                <MessageSquare className="h-8 w-8 text-text-tertiary/50" />
              </div>
              <p className="text-sm text-text-secondary">Select an asset to view comments</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
