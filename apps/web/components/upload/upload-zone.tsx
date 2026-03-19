'use client'

import * as React from 'react'
import { Upload, Film, Music, Image } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void
  className?: string
}

export function UploadZone({ onFilesSelected, className }: UploadZoneProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      onFilesSelected(Array.from(files))
    },
    [onFilesSelected],
  )

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set false when leaving the outer element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors',
        isDragging
          ? 'border-accent bg-accent-muted/30'
          : 'border-border bg-bg-secondary hover:border-border-focus hover:bg-bg-tertiary',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Icon cluster */}
      <div className="relative flex items-center justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-muted text-accent">
          <Upload className="h-6 w-6" />
        </div>
        <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary border border-border text-text-tertiary">
          <Film className="h-3 w-3" />
        </div>
        <div className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary border border-border text-text-tertiary">
          <Music className="h-3 w-3" />
        </div>
      </div>

      {/* Text */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-text-primary">
          Drop files here or <span className="text-accent">click to browse</span>
        </p>
        <p className="text-xs text-text-tertiary">
          Video, audio, and image files — up to 10 GB
        </p>
      </div>

      {/* Supported types */}
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <Film className="h-3.5 w-3.5" />
          MP4, MOV, MKV
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1">
          <Music className="h-3.5 w-3.5" />
          MP3, WAV, FLAC
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1">
          <Image className="h-3.5 w-3.5" />
          JPG, PNG, WebP
        </span>
      </div>
    </div>
  )
}
