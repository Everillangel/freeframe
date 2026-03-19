'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { AssetGrid } from '@/components/projects/asset-grid'
import type { Asset } from '@/types'

type AssetFilter = 'all' | 'owned' | 'shared' | 'mentioned' | 'assigned' | 'due_soon'

interface FilterOption {
  value: AssetFilter
  label: string
  apiParam: string | null
}

const FILTERS: FilterOption[] = [
  { value: 'all', label: 'All', apiParam: null },
  { value: 'owned', label: 'Owned', apiParam: 'owned' },
  { value: 'shared', label: 'Shared with me', apiParam: 'shared' },
  { value: 'mentioned', label: 'Mentioned', apiParam: 'mentioned' },
  { value: 'assigned', label: 'Assigned', apiParam: 'assigned' },
  { value: 'due_soon', label: 'Due soon', apiParam: 'due_soon' },
]

function buildKey(filter: AssetFilter): string {
  const opt = FILTERS.find((f) => f.value === filter)!
  return opt.apiParam ? `/me/assets?filter=${opt.apiParam}` : '/me/assets'
}

export default function AssetsPage() {
  const [activeFilter, setActiveFilter] = React.useState<AssetFilter>('all')

  const swrKey = buildKey(activeFilter)

  const { data: assets, isLoading } = useSWR<Asset[]>(
    swrKey,
    () => api.get<Asset[]>(swrKey),
    { keepPreviousData: true },
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">My Assets</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          All assets accessible to you across projects.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={cn(
              'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors border',
              activeFilter === f.value
                ? 'bg-accent text-text-inverse border-accent'
                : 'bg-bg-secondary text-text-secondary border-border hover:bg-bg-hover',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Asset grid — no project context for discovery view */}
      <AssetGrid
        assets={assets ?? []}
        projectId=""
        isLoading={isLoading}
      />

      {/* Empty state when nothing matches */}
      {!isLoading && assets?.length === 0 && activeFilter === 'all' && (
        <div className="rounded-lg border border-border bg-bg-secondary flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary text-text-tertiary">
            <Layers className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-text-primary">No assets yet</p>
          <p className="text-xs text-text-secondary">
            Assets from your projects will appear here.
          </p>
        </div>
      )}
    </div>
  )
}
