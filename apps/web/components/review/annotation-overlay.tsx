'use client'

import React, { useEffect, useRef } from 'react'
import { useReviewStore } from '@/stores/review-store'

/**
 * Read-only overlay that renders a saved Fabric.js annotation on top of the video.
 * Shown when a comment with an annotation is focused/hovered.
 */
export function AnnotationOverlay() {
  const activeAnnotation = useReviewStore((s) => s.activeAnnotation)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!activeAnnotation || !canvasRef.current || !containerRef.current) return

    let disposed = false

    const render = async () => {
      const { Canvas } = await import('fabric')
      if (disposed || !canvasRef.current || !containerRef.current) return

      const { width, height } = containerRef.current.getBoundingClientRect()
      const w = Math.floor(width)
      const h = Math.floor(height)

      const canvas = new Canvas(canvasRef.current, {
        selection: false,
        renderOnAddRemove: false,
        skipTargetFind: true,
        interactive: false,
      })

      canvas.setDimensions({ width: w, height: h })

      try {
        // The drawing_data contains the original canvas dimensions + objects
        const data = activeAnnotation as any
        const origWidth = data.width || w
        const origHeight = data.height || h
        const scaleX = w / origWidth
        const scaleY = h / origHeight

        await canvas.loadFromJSON(activeAnnotation)

        // Scale objects to fit current container size
        if (scaleX !== 1 || scaleY !== 1) {
          canvas.getObjects().forEach((obj) => {
            obj.set({
              left: (obj.left ?? 0) * scaleX,
              top: (obj.top ?? 0) * scaleY,
              scaleX: (obj.scaleX ?? 1) * scaleX,
              scaleY: (obj.scaleY ?? 1) * scaleY,
            })
            obj.setCoords()
          })
        }

        canvas.renderAll()
      } catch {
        // annotation data may be invalid
      }

      return () => {
        try { canvas.dispose() } catch { /* ignore */ }
      }
    }

    let cleanup: (() => void) | undefined
    render().then((fn) => { cleanup = fn })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [activeAnnotation])

  if (!activeAnnotation) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-10 pointer-events-none"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
      />
    </div>
  )
}
