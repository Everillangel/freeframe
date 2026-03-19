'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { Plus, ChevronRight, Filter, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CollectionCard } from '@/components/projects/collection-card'
import { EmptyState } from '@/components/shared/empty-state'
import type { Collection, Project } from '@/types'

// ─── Filter Rule Builder ───────────────────────────────────────────────────────

type FilterOperator = 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in'

interface FilterRule {
  id: string
  field: string
  operator: FilterOperator
  value: string
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'in', label: 'in (comma-separated)' },
]

function buildFilterJson(rules: FilterRule[]): Record<string, unknown> {
  if (rules.length === 0) return {}
  return {
    and: rules.map((r) => ({
      field: r.field,
      operator: r.operator,
      value: r.operator === 'in' ? r.value.split(',').map((v) => v.trim()) : r.value,
    })),
  }
}

function FilterRuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: FilterRule
  onChange: (patch: Partial<FilterRule>) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        placeholder="field name"
        value={rule.field}
        onChange={(e) => onChange({ field: e.target.value })}
        className="flex h-8 w-28 rounded-md border border-border bg-bg-secondary px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
      />
      <select
        value={rule.operator}
        onChange={(e) => onChange({ operator: e.target.value as FilterOperator })}
        className="flex h-8 rounded-md border border-border bg-bg-secondary px-2 text-sm text-text-primary focus:outline-none focus:border-border-focus"
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="value"
        value={rule.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="flex h-8 flex-1 rounded-md border border-border bg-bg-secondary px-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-text-tertiary hover:text-status-error transition-colors"
        aria-label="Remove rule"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CollectionsPage() {
  const params = useParams()
  const projectId = params.id as string

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [formError, setFormError] = React.useState('')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [rules, setRules] = React.useState<FilterRule[]>([])

  const { data: project } = useSWR<Project>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  )

  const { data: collections, isLoading, mutate } = useSWR<Collection[]>(
    `/projects/${projectId}/collections`,
    () => api.get<Collection[]>(`/projects/${projectId}/collections`),
  )

  const resetForm = () => {
    setName('')
    setDescription('')
    setRules([])
    setFormError('')
  }

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { id: `${Date.now()}`, field: '', operator: 'equals', value: '' },
    ])
  }

  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const removeRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setFormError('Collection name is required.')
      return
    }

    setIsCreating(true)
    setFormError('')

    try {
      await api.post<Collection>(`/projects/${projectId}/collections`, {
        name: name.trim(),
        description: description.trim() || null,
        filter_rules: buildFilterJson(rules),
      })
      await mutate()
      setDialogOpen(false)
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create collection')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Link href="/projects" className="hover:text-text-primary transition-colors">
          Projects
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link
          href={`/projects/${projectId}`}
          className="hover:text-text-primary transition-colors"
        >
          {project?.name ?? '...'}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-secondary">Collections</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Collections</h1>
          {collections && (
            <p className="mt-0.5 text-sm text-text-secondary">
              {collections.length} collection{collections.length !== 1 ? 's' : ''}
            </p>
          )}
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
              New Collection
            </Button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl overflow-y-auto max-h-[90vh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
              <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>

              <Dialog.Title className="text-base font-semibold text-text-primary">
                New Collection
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-text-secondary">
                Smart collections automatically group assets based on metadata filter rules.
              </Dialog.Description>

              <form onSubmit={handleCreate} className="mt-5 space-y-4">
                <Input
                  label="Collection name"
                  placeholder="e.g. Approved Videos"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-text-secondary">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Optional description..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="flex w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus"
                  />
                </div>

                {/* Filter rules */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">
                      Filter rules
                    </label>
                    <button
                      type="button"
                      onClick={addRule}
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add rule
                    </button>
                  </div>

                  {rules.length === 0 ? (
                    <p className="text-xs text-text-tertiary">
                      No filter rules — collection will include all assets.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {rules.map((rule) => (
                        <FilterRuleRow
                          key={rule.id}
                          rule={rule}
                          onChange={(patch) => updateRule(rule.id, patch)}
                          onRemove={() => removeRule(rule.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

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
                    Create collection
                  </Button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-bg-secondary" />
          ))}
        </div>
      ) : !collections || collections.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={Filter}
            title="No collections yet"
            description="Create a smart collection to automatically group assets by metadata rules."
            action={{ label: 'New Collection', onClick: () => setDialogOpen(true) }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
            />
          ))}
        </div>
      )}
    </div>
  )
}
