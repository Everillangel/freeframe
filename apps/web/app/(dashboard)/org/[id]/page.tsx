'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { Users, FolderOpen, UsersRound, HardDrive, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { ActivityLog } from '@/types'

interface OrgStats {
  total_users: number
  total_teams: number
  total_projects: number
  storage_used_bytes: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: React.ElementType
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-muted shrink-0">
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-text-primary">{value}</p>
        <p className="text-xs text-text-tertiary">{label}</p>
      </div>
    </div>
  )
}

export default function OrgOverviewPage() {
  const params = useParams()
  const orgId = params.id as string

  const { data: stats, isLoading: loadingStats } = useSWR<OrgStats>(
    `/admin/org/${orgId}/stats`,
    () => api.get<OrgStats>(`/admin/org/${orgId}/stats`),
  )

  const { data: activity, isLoading: loadingActivity } = useSWR<ActivityLog[]>(
    `/admin/org/${orgId}/audit-log?per_page=10`,
    () => api.get<ActivityLog[]>(`/admin/org/${orgId}/audit-log?per_page=10`),
  )

  const actionLabels: Record<string, string> = {
    created: 'created an asset',
    commented: 'left a comment',
    mentioned: 'mentioned someone',
    shared: 'shared an asset',
    assigned: 'assigned an asset',
    approved: 'approved an asset',
    rejected: 'rejected an asset',
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Quick stats */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Overview</h2>
        {loadingStats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-bg-tertiary" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Members" value={stats?.total_users ?? 0} icon={Users} />
            <StatCard label="Teams" value={stats?.total_teams ?? 0} icon={UsersRound} />
            <StatCard label="Projects" value={stats?.total_projects ?? 0} icon={FolderOpen} />
            <StatCard
              label="Storage used"
              value={formatBytes(stats?.storage_used_bytes ?? 0)}
              icon={HardDrive}
            />
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-text-secondary" />
          <h2 className="text-sm font-semibold text-text-primary">Recent Activity</h2>
        </div>

        {loadingActivity ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-bg-tertiary" />
            ))}
          </div>
        ) : !activity || activity.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
            <p className="text-sm text-text-secondary">No recent activity.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border overflow-hidden">
            {activity.map((log) => (
              <div key={log.id} className="flex items-center justify-between px-4 py-3">
                <p className="text-sm text-text-secondary">
                  <span className="font-medium text-text-primary">User</span>{' '}
                  {actionLabels[log.action] ?? log.action}
                </p>
                <span className="text-xs text-text-tertiary shrink-0 ml-4">
                  {formatRelativeTime(log.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
