'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as Dialog from '@radix-ui/react-dialog'
import * as Select from '@radix-ui/react-select'
import { Plus, LayoutGrid, List, FolderOpen, ChevronDown, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProjectCard } from '@/components/projects/project-card'
import { EmptyState } from '@/components/shared/empty-state'
import type { Project, Team, ProjectType } from '@/types'

type ViewMode = 'grid' | 'list'

interface CreateProjectForm {
  name: string
  description: string
  project_type: ProjectType
  team_id: string
}

export default function ProjectsPage() {
  const router = useRouter()
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [formError, setFormError] = React.useState('')

  const [form, setForm] = React.useState<CreateProjectForm>({
    name: '',
    description: '',
    project_type: 'personal',
    team_id: '',
  })

  const { data: projects, isLoading, mutate } = useSWR<Project[]>(
    '/projects',
    () => api.get<Project[]>('/projects'),
  )

  const { data: teams } = useSWR<Team[]>(
    form.project_type === 'team' ? '/teams' : null,
    () => api.get<Team[]>('/teams'),
  )

  const resetForm = () => {
    setForm({ name: '', description: '', project_type: 'personal', team_id: '' })
    setFormError('')
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Project name is required.')
      return
    }
    if (form.project_type === 'team' && !form.team_id) {
      setFormError('Please select a team.')
      return
    }

    setIsCreating(true)
    setFormError('')

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        project_type: form.project_type,
      }
      if (form.project_type === 'team' && form.team_id) {
        payload.team_id = form.team_id
      }

      const created = await api.post<Project>('/projects', payload)
      await mutate()
      setDialogOpen(false)
      resetForm()
      router.push(`/projects/${created.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project'
      setFormError(message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Projects</h1>
          {projects && (
            <p className="mt-0.5 text-sm text-text-secondary">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-1.5 transition-colors',
                viewMode === 'grid' ? 'bg-accent-muted text-accent' : 'text-text-secondary hover:bg-bg-hover',
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1.5 transition-colors',
                viewMode === 'list' ? 'bg-accent-muted text-accent' : 'text-text-secondary hover:bg-bg-hover',
              )}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <Dialog.Root
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open)
              if (!open) resetForm()
            }}
          >
            <Dialog.Trigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </Dialog.Trigger>

            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                {/* Close button */}
                <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
                  <X className="h-4 w-4" />
                </Dialog.Close>

                <Dialog.Title className="text-base font-semibold text-text-primary">
                  New Project
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  Create a personal or team project to organize your assets.
                </Dialog.Description>

                <form onSubmit={handleCreate} className="mt-5 space-y-4">
                  <Input
                    label="Project name"
                    placeholder="e.g. Brand Campaign 2025"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Optional description..."
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      className="flex w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus"
                    />
                  </div>

                  {/* Project type */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      Project type
                    </label>
                    <div className="flex gap-2">
                      {(['personal', 'team'] as ProjectType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, project_type: type, team_id: '' }))}
                          className={cn(
                            'flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors',
                            form.project_type === type
                              ? 'border-accent bg-accent-muted text-accent'
                              : 'border-border bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Team selector */}
                  {form.project_type === 'team' && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-text-secondary">
                        Team
                      </label>
                      <Select.Root
                        value={form.team_id}
                        onValueChange={(val) => setForm((f) => ({ ...f, team_id: val }))}
                      >
                        <Select.Trigger className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus data-[placeholder]:text-text-tertiary">
                          <Select.Value placeholder="Select a team" />
                          <Select.Icon>
                            <ChevronDown className="h-4 w-4 text-text-tertiary" />
                          </Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-bg-secondary shadow-lg">
                            <Select.Viewport className="p-1">
                              {teams?.map((team) => (
                                <Select.Item
                                  key={team.id}
                                  value={team.id}
                                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-text-primary outline-none hover:bg-bg-hover data-[highlighted]:bg-bg-hover"
                                >
                                  <Select.ItemText>{team.name}</Select.ItemText>
                                  <Select.ItemIndicator className="ml-auto">
                                    <Check className="h-3.5 w-3.5 text-accent" />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                              {!teams?.length && (
                                <div className="px-2 py-1.5 text-sm text-text-tertiary">
                                  No teams found
                                </div>
                              )}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>
                  )}

                  {formError && (
                    <p className="text-sm text-status-error">{formError}</p>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Dialog.Close asChild>
                      <Button type="button" variant="secondary" size="sm">
                        Cancel
                      </Button>
                    </Dialog.Close>
                    <Button type="submit" size="sm" loading={isCreating}>
                      Create project
                    </Button>
                  </div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div
          className={cn(
            viewMode === 'grid'
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
              : 'flex flex-col gap-2',
          )}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-bg-secondary" />
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            description="Create your first project to start organizing assets."
            action={{ label: 'New Project', onClick: () => setDialogOpen(true) }}
          />
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {projects.map((project, i) => (
            <a
              key={project.id}
              href={`/projects/${project.id}`}
              className={cn(
                'flex items-center gap-4 px-4 py-3 hover:bg-bg-hover transition-colors',
                i !== projects.length - 1 && 'border-b border-border',
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div className="flex flex-1 flex-col min-w-0">
                <p className="text-sm font-medium text-text-primary line-clamp-1">
                  {project.name}
                </p>
                {project.description && (
                  <p className="text-xs text-text-secondary line-clamp-1">
                    {project.description}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium border',
                  project.project_type === 'team'
                    ? 'bg-accent-muted text-accent border-accent/20'
                    : 'bg-bg-tertiary text-text-secondary border-border',
                )}
              >
                {project.project_type === 'team' ? 'Team' : 'Personal'}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
