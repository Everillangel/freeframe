'use client'

import { useShareLinkActivity } from '@/hooks/use-share-links'
import { formatRelativeTime } from '@/lib/utils'
import type { ShareActivityAction, ShareLinkActivity } from '@/types'

interface ShareLinkActivityPanelProps {
  token: string
}

const ACTION_LABELS: Record<ShareActivityAction, string> = {
  opened: 'Opened Share Link',
  viewed_asset: 'Viewed Asset',
  commented: 'Commented',
  approved: 'Approved',
  rejected: 'Rejected',
  downloaded: 'Downloaded',
}

function actionLabelColor(action: ShareActivityAction): string {
  if (action === 'approved') return 'text-green-400'
  if (action === 'rejected') return 'text-red-400'
  return 'text-zinc-400'
}

/** Deterministic color from a string — cycles through a small palette */
const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-pink-500',
  'bg-indigo-500',
]

function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** Groups activity events by calendar date label */
function groupByDate(activities: ShareLinkActivity[]): { label: string; items: ShareLinkActivity[] }[] {
  const groups: { label: string; items: ShareLinkActivity[] }[] = []
  const seen: Record<string, number> = {}

  for (const activity of activities) {
    const d = new Date(activity.created_at)
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    if (seen[label] === undefined) {
      seen[label] = groups.length
      groups.push({ label, items: [] })
    }
    groups[seen[label]].items.push(activity)
  }

  return groups
}

export function ShareLinkActivityPanel({ token }: ShareLinkActivityPanelProps) {
  const { activities, isLoading } = useShareLinkActivity(token)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-zinc-700 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/3 rounded bg-zinc-700" />
              <div className="h-2.5 w-1/3 rounded bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-zinc-400">No activity yet</p>
        <p className="mt-1 text-xs text-zinc-600">Activity will appear here once someone views this share link.</p>
      </div>
    )
  }

  const groups = groupByDate(activities)

  return (
    <div className="overflow-y-auto max-h-[480px] py-2">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Date separator */}
          <div className="sticky top-0 z-10 px-4 py-1.5 bg-bg-secondary/90 backdrop-blur-sm">
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
              {group.label}
            </span>
          </div>

          <div className="space-y-0.5 px-3">
            {group.items.map((activity) => {
              const displayName = activity.actor_name || activity.actor_email
              const initial = displayName.charAt(0).toUpperCase()
              const colorClass = avatarColor(activity.actor_email)
              const actionLabel = ACTION_LABELS[activity.action]
              const actionColor = actionLabelColor(activity.action)

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03] transition-colors"
                >
                  {/* Colored initials circle */}
                  <div
                    className={`h-8 w-8 rounded-full ${colorClass} flex items-center justify-center shrink-0 text-white text-xs font-semibold`}
                  >
                    {initial}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="text-sm font-medium text-zinc-200 truncate max-w-[140px]">
                        {displayName}
                      </span>
                      {activity.asset_name && (
                        <>
                          <span className="text-xs text-zinc-600">on</span>
                          <span className="text-xs text-zinc-400 truncate max-w-[120px]">
                            {activity.asset_name}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-medium ${actionColor}`}>{actionLabel}</span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-xs text-zinc-600">{formatRelativeTime(activity.created_at)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
