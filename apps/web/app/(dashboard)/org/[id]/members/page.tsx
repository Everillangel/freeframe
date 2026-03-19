'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate as globalMutate } from 'swr'
import * as Dialog from '@radix-ui/react-dialog'
import * as Select from '@radix-ui/react-select'
import { Users, Plus, X, ChevronDown, Check, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/shared/avatar'
import { EmptyState } from '@/components/shared/empty-state'
import type { OrgRole, UserStatus } from '@/types'

interface OrgUser {
  id: string
  user_id: string
  name: string
  email: string
  avatar_url: string | null
  role: OrgRole
  status: UserStatus
  joined_at: string | null
  last_active?: string | null
}

function RoleSelect({
  value,
  onChange,
}: {
  value: OrgRole
  onChange: (v: OrgRole) => void
}) {
  const roles: OrgRole[] = ['owner', 'admin', 'member']
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as OrgRole)}>
      <Select.Trigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-secondary px-2.5 py-1 text-xs text-text-primary hover:bg-bg-tertiary transition-colors focus:outline-none focus:ring-1 focus:ring-border-focus capitalize">
        <Select.Value />
        <ChevronDown className="h-3 w-3 text-text-tertiary" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 min-w-[120px] overflow-hidden rounded-md border border-border bg-bg-secondary shadow-xl">
          <Select.Viewport className="p-1">
            {roles.map((role) => (
              <Select.Item
                key={role}
                value={role}
                className="relative flex items-center gap-2 rounded-sm px-7 py-1.5 text-xs text-text-primary outline-none data-[highlighted]:bg-bg-hover cursor-pointer capitalize"
              >
                <Select.ItemIndicator className="absolute left-2">
                  <Check className="h-3 w-3 text-accent" />
                </Select.ItemIndicator>
                <Select.ItemText>{role}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

function InviteMemberDialog({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState<OrgRole>('member')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/organizations/${orgId}/members`, { email: email.trim(), role })
      setOpen(false)
      setEmail('')
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Invite Member
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </Dialog.Close>
          <Dialog.Title className="text-base font-semibold text-text-primary">Invite Member</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">
            Invite a user to this organization by email.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Role</label>
              <RoleSelect value={role} onChange={setRole} />
            </div>
            {error && <p className="text-xs text-status-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={loading}>
                Send Invite
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function BulkInviteDialog({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [emails, setEmails] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [success, setSuccess] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const emailList = emails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (emailList.length === 0) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await api.post(`/admin/org/${orgId}/users/bulk-invite`, { emails: emailList })
      setSuccess(`${emailList.length} invite(s) sent.`)
      setEmails('')
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invites')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm">
          <Upload className="h-4 w-4" />
          Bulk Invite
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
            <X className="h-4 w-4" />
          </Dialog.Close>
          <Dialog.Title className="text-base font-semibold text-text-primary">Bulk Invite</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">
            Enter emails separated by commas or newlines.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Email addresses</label>
              <textarea
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder={"user1@example.com\nuser2@example.com"}
                rows={5}
                className="flex w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus resize-none"
              />
            </div>
            {error && <p className="text-xs text-status-error">{error}</p>}
            {success && <p className="text-xs text-status-success">{success}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="submit" size="sm" loading={loading}>
                Send Invites
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function userStatusBadge(status: UserStatus) {
  const map: Record<UserStatus, { label: string; className: string }> = {
    active: { label: 'Active', className: 'bg-[oklch(0.35_0.12_152/0.25)] text-status-success' },
    deactivated: { label: 'Deactivated', className: 'bg-[oklch(0.35_0.1_25/0.25)] text-status-error' },
    pending_invite: { label: 'Pending', className: 'bg-[oklch(0.35_0.12_70/0.25)] text-status-warning' },
    pending_verification: { label: 'Unverified', className: 'bg-bg-tertiary text-text-secondary' },
  }
  const cfg = map[status] ?? map.active
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.className)}>
      {cfg.label}
    </span>
  )
}

export default function OrgMembersPage() {
  const params = useParams()
  const orgId = params.id as string

  const key = `/admin/org/${orgId}/users`
  const { data: members, isLoading } = useSWR<OrgUser[]>(
    key,
    () => api.get<OrgUser[]>(key),
  )

  const handleRoleChange = async (userId: string, role: OrgRole) => {
    try {
      await api.patch(`/organizations/${orgId}/members/${userId}`, { role })
      globalMutate(key)
    } catch {
      // ignore
    }
  }

  const handleRemove = async (userId: string) => {
    try {
      await api.delete(`/organizations/${orgId}/members/${userId}`)
      globalMutate(key)
    } catch {
      // ignore
    }
  }

  const handleDeactivate = async (userId: string) => {
    try {
      await api.patch(`/users/${userId}/deactivate`)
      globalMutate(key)
    } catch {
      // ignore
    }
  }

  const handleReactivate = async (userId: string) => {
    try {
      await api.patch(`/users/${userId}/reactivate`)
      globalMutate(key)
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          Members {members && `(${members.length})`}
        </h2>
        <div className="flex items-center gap-2">
          <BulkInviteDialog orgId={orgId} onDone={() => globalMutate(key)} />
          <InviteMemberDialog orgId={orgId} onDone={() => globalMutate(key)} />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-bg-tertiary" />
          ))}
        </div>
      ) : !members || members.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={Users}
            title="No members"
            description="Invite people to join this organization."
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-tertiary">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Member</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Role</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Joined</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-text-tertiary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-border last:border-0 hover:bg-bg-tertiary transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar src={member.avatar_url} name={member.name} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{member.name}</p>
                        <p className="text-xs text-text-tertiary truncate">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleSelect
                      value={member.role}
                      onChange={(role) => handleRoleChange(member.user_id, role)}
                    />
                  </td>
                  <td className="px-4 py-3">{userStatusBadge(member.status)}</td>
                  <td className="px-4 py-3 text-xs text-text-tertiary">
                    {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {member.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeactivate(member.user_id)}
                          className="text-xs text-status-warning hover:text-status-warning"
                        >
                          Deactivate
                        </Button>
                      ) : member.status === 'deactivated' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReactivate(member.user_id)}
                          className="text-xs"
                        >
                          Reactivate
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member.user_id)}
                        className="text-xs text-status-error hover:text-status-error"
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
