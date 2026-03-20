'use client'

import React, { useCallback, useState } from 'react'
import { Folder, MoreHorizontal, Pencil, Trash } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Folder as FolderType } from '@/types'

interface FolderCardProps {
  folder: FolderType
  selected?: boolean
  onOpen: (folder: FolderType) => void
  onSelect?: (e: React.MouseEvent) => void
  onRename?: (folderId: string, name: string) => Promise<void>
  onDelete?: (folderId: string) => Promise<void>
  onDropItems?: (targetFolderId: string, assetIds: string[], folderIds: string[]) => void
  className?: string
}

export function FolderCard({
  folder,
  selected,
  onOpen,
  onSelect,
  onRename,
  onDelete,
  onDropItems,
  className,
}: FolderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // Draggable
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({ folderIds: [folder.id], assetIds: [] }),
      )
      e.dataTransfer.effectAllowed = 'move'
    },
    [folder.id],
  )

  // Drop target
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        // Don't allow dropping a folder onto itself
        if (data.folderIds?.includes(folder.id)) return
        onDropItems?.(folder.id, data.assetIds ?? [], data.folderIds ?? [])
      } catch {}
    },
    [folder.id, onDropItems],
  )

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-bg-tertiary/50 cursor-pointer transition-all hover:border-white/15 hover:scale-[1.01]',
        selected ? 'ring-2 ring-accent border-accent/50' : 'border-border',
        isDragOver && 'ring-2 ring-accent/50 bg-accent/5',
        className,
      )}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onDoubleClick={() => onOpen(folder)}
      onClick={onSelect}
    >
      {/* Folder icon area */}
      <div className="aspect-[4/3] flex items-center justify-center bg-white/[0.02] rounded-t-lg">
        <Folder className="h-12 w-12 text-text-tertiary/50" />
      </div>

      {/* Info */}
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium text-text-primary truncate">{folder.name}</p>
          <div className="relative">
            <button
              className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-6 w-6 rounded hover:bg-white/10 transition-opacity shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((p) => !p)
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-text-tertiary" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-white/10 bg-[#232328] shadow-xl py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/5"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    const name = prompt('New name:', folder.name)
                    if (name) onRename?.(folder.id, name)
                  }}
                >
                  <Pencil className="h-3 w-3" /> Rename
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    if (confirm(`Delete "${folder.name}" and all contents?`)) onDelete?.(folder.id)
                  }}
                >
                  <Trash className="h-3 w-3" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-text-tertiary mt-0.5">
          {folder.item_count} {folder.item_count === 1 ? 'Item' : 'Items'}
        </p>
      </div>
    </div>
  )
}
