'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import useSWR, { mutate as globalMutate } from 'swr'
import { HardDrive, ShieldCheck, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatRelativeTime } from '@/lib/utils'
import type { Organization } from '@/types'

interface StorageBreakdown {
  by_team: { name: string; bytes: number }[]
  by_user: { name: string; bytes: number }[]
  by_project: { name: string; bytes: number }[]
  total_bytes: number
}

interface AuditEntry {
  id: string
  user_name: string
  action: string
  target: string
  created_at: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function OrgSettingsPage() {
  const params = useParams()
  const orgId = params.id as string

  const orgKey = `/organizations/${orgId}`
  const { data: org } = useSWR<Organization>(
    orgKey,
    () => api.get<Organization>(orgKey),
  )

  const { data: storage } = useSWR<StorageBreakdown>(
    `/admin/org/${orgId}/storage`,
    () => api.get<StorageBreakdown>(`/admin/org/${orgId}/storage`),
  )

  const { data: auditLog, isLoading: loadingAudit } = useSWR<AuditEntry[]>(
    `/admin/org/${orgId}/audit-log`,
    () => api.get<AuditEntry[]>(`/admin/org/${orgId}/audit-log`),
  )

  const [name, setName] = React.useState('')
  const [savingSettings, setSavingSettings] = React.useState(false)
  const [settingsMsg, setSettingsMsg] = React.useState('')
  const [auditPage, setAuditPage] = React.useState(1)
  const [auditFilter, setAuditFilter] = React.useState('')

  React.useEffect(() => {
    if (org) {
      setName(org.name)
    }
  }, [org])

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSettings(true)
    setSettingsMsg('')
    try {
      await api.patch(`/admin/org/${orgId}/settings`, { name: name.trim() })
      setSettingsMsg('Settings saved.')
      globalMutate(orgKey)
    } catch (err: unknown) {
      setSettingsMsg(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingSettings(false)
    }
  }

  const filteredAudit = React.useMemo(() => {
    if (!auditLog) return []
    if (!auditFilter) return auditLog
    const q = auditFilter.toLowerCase()
    return auditLog.filter(
      (e) =>
        e.user_name?.toLowerCase().includes(q) ||
        e.action?.toLowerCase().includes(q) ||
        e.target?.toLowerCase().includes(q),
    )
  }, [auditLog, auditFilter])

  const AUDIT_PER_PAGE = 20
  const auditPageCount = Math.max(1, Math.ceil(filteredAudit.length / AUDIT_PER_PAGE))
  const auditPageItems = filteredAudit.slice(
    (auditPage - 1) * AUDIT_PER_PAGE,
    auditPage * AUDIT_PER_PAGE,
  )

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      {/* General settings */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">General</h2>
        <form onSubmit={handleSaveSettings} className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4">
          <Input
            label="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Productions"
          />
          {settingsMsg && (
            <p className="text-xs text-text-secondary">{settingsMsg}</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={savingSettings}>
              Save changes
            </Button>
          </div>
        </form>
      </section>

      {/* Storage overview */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary">Storage</h2>
          {storage && (
            <span className="text-xs text-text-tertiary ml-auto">
              Total: {formatBytes(storage.total_bytes)}
            </span>
          )}
        </div>

        {storage && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* By project */}
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <p className="text-xs font-medium text-text-secondary mb-2">By Project</p>
              <div className="space-y-1.5">
                {storage.by_project.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-text-primary truncate max-w-[120px]">{item.name}</span>
                    <span className="text-text-tertiary ml-2">{formatBytes(item.bytes)}</span>
                  </div>
                ))}
                {storage.by_project.length === 0 && (
                  <p className="text-xs text-text-tertiary">No data</p>
                )}
              </div>
            </div>
            {/* By team */}
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <p className="text-xs font-medium text-text-secondary mb-2">By Team</p>
              <div className="space-y-1.5">
                {storage.by_team.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-text-primary truncate max-w-[120px]">{item.name}</span>
                    <span className="text-text-tertiary ml-2">{formatBytes(item.bytes)}</span>
                  </div>
                ))}
                {storage.by_team.length === 0 && (
                  <p className="text-xs text-text-tertiary">No data</p>
                )}
              </div>
            </div>
            {/* By user */}
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <p className="text-xs font-medium text-text-secondary mb-2">By User</p>
              <div className="space-y-1.5">
                {storage.by_user.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-text-primary truncate max-w-[120px]">{item.name}</span>
                    <span className="text-text-tertiary ml-2">{formatBytes(item.bytes)}</span>
                  </div>
                ))}
                {storage.by_user.length === 0 && (
                  <p className="text-xs text-text-tertiary">No data</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Audit log */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary">Audit Log</h2>
        </div>

        <Input
          placeholder="Filter by user, action, or target..."
          value={auditFilter}
          onChange={(e) => {
            setAuditFilter(e.target.value)
            setAuditPage(1)
          }}
        />

        {loadingAudit ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-tertiary" />
            ))}
          </div>
        ) : auditPageItems.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
            <p className="text-sm text-text-secondary">No audit entries found.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-tertiary">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">User</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Action</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-text-tertiary">Target</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-text-tertiary">
                    <Clock className="h-3 w-3 inline" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditPageItems.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-bg-tertiary transition-colors">
                    <td className="px-4 py-3 text-text-primary">{entry.user_name}</td>
                    <td className="px-4 py-3 text-text-secondary capitalize">{entry.action}</td>
                    <td className="px-4 py-3 text-text-tertiary truncate max-w-[200px]">{entry.target}</td>
                    <td className="px-4 py-3 text-right text-xs text-text-tertiary whitespace-nowrap">
                      {formatRelativeTime(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {auditPageCount > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2">
                <span className="text-xs text-text-tertiary">
                  Page {auditPage} of {auditPageCount}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    disabled={auditPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuditPage((p) => Math.min(auditPageCount, p + 1))}
                    disabled={auditPage === auditPageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
