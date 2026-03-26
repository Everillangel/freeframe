'use client'

import { useEffect, useMemo } from 'react'
import { useUploadStore } from '@/stores/upload-store'
import { useSSE } from '@/hooks/use-sse'

/**
 * Bridges SSE transcode events to the upload store.
 * Renders one SSE connection per project that has processing uploads.
 * Also polls every 5s as a fallback for missed SSE events (e.g. fast-processing files).
 */
export function UploadSSEBridge() {
  const files = useUploadStore((s) => s.files)
  const refreshProcessingItems = useUploadStore((s) => s.refreshProcessingItems)

  const processingProjectIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of files) {
      if (f.status === 'processing' && f.projectId) {
        ids.add(f.projectId)
      }
    }
    return Array.from(ids)
  }, [files])

  // Fallback: poll every 5s when items are processing to catch missed SSE events
  useEffect(() => {
    if (processingProjectIds.length === 0) return
    const timer = setInterval(() => { refreshProcessingItems() }, 5000)
    return () => clearInterval(timer)
  }, [processingProjectIds.length, refreshProcessingItems])

  return (
    <>
      {processingProjectIds.map((pid) => (
        <SSEListener key={pid} projectId={pid} />
      ))}
    </>
  )
}

function SSEListener({ projectId }: { projectId: string }) {
  const { updateProcessingProgress, markProcessingComplete, markProcessingFailed } = useUploadStore()

  useSSE(projectId, {
    onTranscodeProgress: (data) => {
      updateProcessingProgress(data.asset_id, data.percent)
    },
    onTranscodeComplete: (data) => {
      markProcessingComplete(data.asset_id)
    },
    onTranscodeFailed: (data) => {
      markProcessingFailed(data.asset_id, data.error)
    },
  })

  return null
}
