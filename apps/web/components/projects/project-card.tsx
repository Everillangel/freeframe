'use client'

import * as React from 'react'
import Link from 'next/link'
import { Users, FolderOpen, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '@/types'

interface ProjectCardProps {
  project: Project
  memberCount?: number
  assetCount?: number
  className?: string
}

export function ProjectCard({
  project,
  memberCount = 0,
  assetCount = 0,
  className,
}: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-4',
        'hover:border-border-focus hover:bg-bg-tertiary transition-colors',
        className,
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent">
            <FolderOpen className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-text-primary line-clamp-1 group-hover:text-accent transition-colors">
            {project.name}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium',
            project.project_type === 'team'
              ? 'bg-accent-muted text-accent border border-accent/20'
              : 'bg-bg-tertiary text-text-secondary border border-border',
          )}
        >
          {project.project_type === 'team' ? 'Team' : 'Personal'}
        </span>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-xs text-text-secondary line-clamp-2">
          {project.description}
        </p>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {memberCount} member{memberCount !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          {assetCount} asset{assetCount !== 1 ? 's' : ''}
        </span>
      </div>
    </Link>
  )
}
