'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { Settings, Upload, Users, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/shared/avatar'
import { AssetGrid } from '@/components/projects/asset-grid'
import { UploadZone } from '@/components/upload/upload-zone'
import { UploadProgress } from '@/components/upload/upload-progress'
import { useUpload } from '@/hooks/use-upload'
import type { Project, Asset, ProjectMember, User } from '@/types'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string

  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [assetName, setAssetName] = React.useState('')
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([])

  const { files: uploadFiles, startUpload, cancelUpload, removeFile, clearCompleted } = useUpload()

  const { data: project, isLoading: loadingProject } = useSWR<Project>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  )

  const { data: assets, isLoading: loadingAssets, mutate: mutateAssets } = useSWR<Asset[]>(
    `/projects/${projectId}/assets`,
    () => api.get<Asset[]>(`/projects/${projectId}/assets`),
  )

  const { data: members } = useSWR<ProjectMember[]>(
    `/projects/${projectId}/members`,
    () => api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  )

  // Fetch assignee users for assets that have one
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

  // When upload completes, refresh assets
  React.useEffect(() => {
    const anyComplete = uploadFiles.some((f) => f.status === 'complete')
    if (anyComplete) {
      mutateAssets()
    }
  }, [uploadFiles, mutateAssets])

  const handleFilesSelected = (files: File[]) => {
    setPendingFiles(files)
    // Default asset name to first file name (without extension)
    if (files.length > 0) {
      setAssetName(files[0].name.replace(/\.[^/.]+$/, ''))
    }
  }

  const handleStartUpload = () => {
    pendingFiles.forEach((file) => {
      const name = pendingFiles.length === 1 ? assetName || file.name : file.name
      startUpload(file, projectId, name)
    })
    setPendingFiles([])
    setAssetName('')
    setUploadOpen(false)
  }

  const displayMembers = members?.slice(0, 5) ?? []
  const extraMemberCount = (members?.length ?? 0) - displayMembers.length

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Link href="/projects" className="hover:text-text-primary transition-colors">
          Projects
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">
          {loadingProject ? '...' : project?.name}
        </span>
      </nav>

      {/* Project header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {loadingProject ? (
            <>
              <div className="h-6 w-48 animate-pulse rounded bg-bg-tertiary" />
              <div className="h-4 w-72 animate-pulse rounded bg-bg-tertiary" />
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-text-primary">
                {project?.name}
              </h1>
              {project?.description && (
                <p className="text-sm text-text-secondary">{project.description}</p>
              )}
            </>
          )}

          {/* Member avatars */}
          {displayMembers.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="flex -space-x-2">
                {displayMembers.map((m) => (
                  <Avatar key={m.id} size="sm" className="ring-2 ring-bg-primary" />
                ))}
              </div>
              {extraMemberCount > 0 && (
                <span className="text-xs text-text-tertiary">
                  +{extraMemberCount} more
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-text-tertiary ml-1">
                <Users className="h-3 w-3" />
                {members?.length} member{members?.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/projects/${projectId}/settings`}>
            <Button variant="ghost" size="sm">
              <Settings className="h-4 w-4" />
              Settings
            </Button>
          </Link>

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

                <Dialog.Title className="text-base font-semibold text-text-primary">
                  Upload asset
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  Add new media to this project.
                </Dialog.Description>

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
                        <Input
                          label="Asset name"
                          value={assetName}
                          onChange={(e) => setAssetName(e.target.value)}
                          placeholder="e.g. Hero Video Final"
                        />
                      )}

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setPendingFiles([])}
                        >
                          Change files
                        </Button>
                        <Button size="sm" onClick={handleStartUpload}>
                          Start upload
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {/* Active uploads */}
      {uploadFiles.length > 0 && (
        <UploadProgress
          uploads={uploadFiles}
          onCancel={cancelUpload}
          onRemove={removeFile}
          onClearCompleted={clearCompleted}
        />
      )}

      {/* Asset grid */}
      <AssetGrid
        assets={assets ?? []}
        projectId={projectId}
        isLoading={loadingAssets}
        assignees={assigneesMap}
        onUpload={() => setUploadOpen(true)}
      />
    </div>
  )
}
