'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import type { FolderTreeNode } from '@/types'

interface FolderBreadcrumbProps {
  projectName: string
  currentFolderId: string | null
  tree: FolderTreeNode[]
  onNavigate: (folderId: string | null) => void
  onDropItems?: (targetFolderId: string | null, assetIds: string[], folderIds: string[]) => void
}

function buildBreadcrumb(
  tree: FolderTreeNode[],
  targetId: string,
): FolderTreeNode[] {
  // BFS to find path from root to target
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
}: FolderBreadcrumbProps) {
  if (!currentFolderId) return null

  const crumbs = buildBreadcrumb(tree, currentFolderId)

  return (
    <nav className="flex items-center gap-1 text-[13px] text-text-tertiary mb-3 min-w-0">
      <button
        className="hover:text-text-primary transition-colors shrink-0"
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
      {crumbs.map((crumb) => (
        <React.Fragment key={crumb.id}>
          <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary" />
          <button
            className={`hover:text-text-primary transition-colors truncate ${
              crumb.id === currentFolderId ? 'text-text-primary font-medium' : ''
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
