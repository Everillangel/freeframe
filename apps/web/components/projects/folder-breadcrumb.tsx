'use client'

import React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { FolderTreeNode } from '@/types'

interface FolderBreadcrumbProps {
  projectName: string
  currentFolderId: string | null
  tree: FolderTreeNode[]
  onNavigate: (folderId: string | null) => void
  onDropItems?: (targetFolderId: string | null, assetIds: string[], folderIds: string[]) => void
  /** Show "Projects >" prefix link */
  showProjectsLink?: boolean
}

function buildBreadcrumb(
  tree: FolderTreeNode[],
  targetId: string,
): FolderTreeNode[] {
  const path: FolderTreeNode[] = []

  function search(nodes: FolderTreeNode[], trail: FolderTreeNode[]): boolean {
    for (const node of nodes) {
      const newTrail = [...trail, node]
      if (node.id === targetId) {
        path.push(...newTrail)
        return true
      }
      if (search(node.children, newTrail)) return true
    }
    return false
  }

  search(tree, [])
  return path
}

export function FolderBreadcrumb({
  projectName,
  currentFolderId,
  tree,
  onNavigate,
  onDropItems,
  showProjectsLink = false,
}: FolderBreadcrumbProps) {
  const crumbs = currentFolderId ? buildBreadcrumb(tree, currentFolderId) : []

  return (
    <nav className="flex items-center gap-1 text-sm min-w-0">
      {/* Optional "Projects" link */}
      {showProjectsLink && (
        <>
          <Link
            href="/projects"
            className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
          >
            Projects
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
        </>
      )}

      {/* Project root */}
      <button
        className={`transition-colors shrink-0 ${
          !currentFolderId
            ? 'text-text-primary font-semibold'
            : 'text-text-tertiary hover:text-text-primary'
        }`}
        onClick={() => onNavigate(null)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={(e) => {
          e.preventDefault()
          try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'))
            onDropItems?.(null, data.assetIds ?? [], data.folderIds ?? [])
          } catch {}
        }}
      >
        {projectName}
      </button>

      {/* Folder crumbs */}
      {crumbs.map((crumb) => (
        <React.Fragment key={crumb.id}>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          <button
            className={`transition-colors truncate ${
              crumb.id === currentFolderId
                ? 'text-text-primary font-semibold'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
            onClick={() => onNavigate(crumb.id)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={(e) => {
              e.preventDefault()
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'))
                onDropItems?.(crumb.id, data.assetIds ?? [], data.folderIds ?? [])
              } catch {}
            }}
          >
            {crumb.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}
