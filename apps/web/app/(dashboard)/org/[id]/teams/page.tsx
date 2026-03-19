'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate as globalMutate } from 'swr'
import * as Dialog from '@radix-ui/react-dialog'
import { UsersRound, Plus, X, ChevronRight, UserMinus } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/shared/avatar'
import { EmptyState } from '@/components/shared/empty-state'
import type { Team, TeamMember, User } from '@/types'

interface TeamWithStats extends Team {
  member_count?: number
  project_count?: number
}

interface TeamMemberWithUser extends TeamMember {
  name?: string
  email?: string
  avatar_url?: string | null
}

function CreateTeamDialog({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/organizations/${orgId}/teams`, {
        name: name.trim(),
        description: description.trim() || null,
      })
      setOpen(false)
      setName('')
      setDescription('')
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Create Team
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </Dialog.Close>
          <Dialog.Title className="text-base font-semibold text-text-primary">Create Team</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">
            Add a new team to group members together.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Input
              label="Team name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Design Team"
              required
            />
            <Input
              label="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this team works on"
            />
            {error && <p className="text-xs text-status-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={loading}>
                Create
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AddMemberDialog({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [userId, setUserId] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/teams/${teamId}/members`, { user_id: userId.trim() })
      setOpen(false)
      setUserId('')
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="sm">
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </Dialog.Close>
          <Dialog.Title className="text-base font-semibold text-text-primary">Add Member</Dialog.Title>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Input
              label="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID"
              required
            />
            {error && <p className="text-xs text-status-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={loading}>
                Add
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TeamDetail({ team }: { team: TeamWithStats }) {
  const [expanded, setExpanded] = React.useState(false)

  const membersKey = `/teams/${team.id}/members`
  const { data: members } = useSWR<TeamMemberWithUser[]>(
    expanded ? membersKey : null,
    () => api.get<TeamMemberWithUser[]>(membersKey),
  )

  const handleRemoveMember = async (userId: string) => {
    try {
      await api.delete(`/teams/${team.id}/members/${userId}`)
      globalMutate(membersKey)
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-tertiary transition-colors text-left"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-muted shrink-0">
            <UsersRound className="h-4 w-4 text-accent" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">{team.name}</p>
            {team.description && (
              <p className="text-xs text-text-tertiary">{team.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          <span>{team.member_count ?? 0} members</span>
          <span>{team.project_count ?? 0} projects</span>
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary">
            <span className="text-xs font-medium text-text-secondary">Members</span>
            <AddMemberDialog teamId={team.id} onDone={() => globalMutate(membersKey)} />
          </div>
          {!members ? (
            <div className="px-4 py-3 space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-bg-tertiary" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="px-4 py-3 text-xs text-text-tertiary">No members yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar src={m.avatar_url ?? null} name={m.name} size="sm" />
                    <div>
                      <p className="text-sm text-text-primary">{m.name ?? m.user_id}</p>
                      {m.email && <p className="text-xs text-text-tertiary">{m.email}</p>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(m.user_id)}
                    className="text-status-error hover:text-status-error"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OrgTeamsPage() {
  const params = useParams()
  const orgId = params.id as string

  const key = `/admin/org/${orgId}/teams`
  const { data: teams, isLoading } = useSWR<TeamWithStats[]>(
    key,
    () => api.get<TeamWithStats[]>(key),
  )

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          Teams {teams && `(${teams.length})`}
        </h2>
        <CreateTeamDialog orgId={orgId} onDone={() => globalMutate(key)} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-bg-tertiary" />
          ))}
        </div>
      ) : !teams || teams.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Create a team to group members and projects together."
          />
        </div>
      ) : (
        <div className="space-y-2">
          {teams.map((team) => (
            <TeamDetail key={team.id} team={team} />
          ))}
        </div>
      )}
    </div>
  )
}
