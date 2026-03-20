'use client'

import React, { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useDrawing } from '@/hooks/use-drawing'
import { useReviewStore } from '@/stores/review-store'

interface AnnotationCanvasProps {
  onSave?: (drawingData: Record<string, unknown>) => void
  className?: string
}

/**
 * Transparent overlay canvas for drawing annotations on the media viewer.
 * The toolbar is rendered separately in the comment input (Frame.io style).
 */
export function AnnotationCanvas({ onSave, className }: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { isDrawingMode } = useReviewStore()
  const { canvasRef, resize } = useDrawing()

  // Keep Fabric canvas dimensions synced with the container
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sync = () => {
      const { width, height } = container.getBoundingClientRect()
      resize(Math.floor(width), Math.floor(height))
    }

    sync()
    const timer = setTimeout(sync, 100)

    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [resize])

  if (!isDrawingMode) return null

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 z-10', className)}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
    </div>
  )
}
