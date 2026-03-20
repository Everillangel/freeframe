import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useUpload } from '../use-upload'

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

import { api } from '@/lib/api'

function createMockFile(name = 'test.mp4', size = 5 * 1024 * 1024): File {
  const file = new File([new ArrayBuffer(size)], name, { type: 'video/mp4' })
  return file
}

describe('useUpload hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with empty files list', () => {
    const { result } = renderHook(() => useUpload())
    expect(result.current.files).toEqual([])
  })

  it('initiates multipart upload and returns file id', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ upload_id: 'upload-1', asset_id: 'asset-1', version_id: 'ver-1' })
      .mockResolvedValueOnce({ url: 'https://s3.example.com/presigned' })
      .mockResolvedValueOnce({}) // complete

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '"etag-123"' },
    }))

    const { result } = renderHook(() => useUpload())
    const file = createMockFile('test.mp4', 5 * 1024 * 1024)

    let fileId: string
    act(() => {
      fileId = result.current.startUpload(file, 'project-1', 'My Video')
    })

    expect(fileId!).toBeTruthy()

    // File should be added to state
    await waitFor(() => {
      expect(result.current.files).toHaveLength(1)
    })
  })

  it('tracks progress as chunks upload', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ upload_id: 'upload-1', asset_id: 'asset-1', version_id: 'ver-1' })
      .mockResolvedValueOnce({ url: 'https://s3.example.com/part1' })
      .mockResolvedValueOnce({}) // complete

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '"etag-abc"' },
    }))

    const { result } = renderHook(() => useUpload())
    const file = createMockFile('small.mp4', 5 * 1024 * 1024) // 5MB < 10MB chunk = 1 chunk

    act(() => {
      result.current.startUpload(file, 'project-1', 'My Video')
    })

    await waitFor(() => {
      const uploadedFile = result.current.files[0]
      expect(uploadedFile?.status).toBe('complete')
      expect(uploadedFile?.progress).toBe(100)
    })
  })

  it('sets status to failed when upload fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useUpload())
    const file = createMockFile()

    act(() => {
      result.current.startUpload(file, 'project-1', 'Test')
    })

    await waitFor(() => {
      const uploadedFile = result.current.files[0]
      expect(uploadedFile?.status).toBe('failed')
      expect(uploadedFile?.error).toBe('Network error')
    })
  })

  it('handles cancel upload', async () => {
    // Make the presign-part call slow so we can cancel
    vi.mocked(api.post)
      .mockResolvedValueOnce({ upload_id: 'upload-1', asset_id: 'asset-1', version_id: 'ver-1' })
      .mockImplementation(() => new Promise(() => {})) // never resolves

    const { result } = renderHook(() => useUpload())
    const file = createMockFile('large.mp4', 25 * 1024 * 1024) // 25MB = 3 chunks

    let fileId: string
    act(() => {
      fileId = result.current.startUpload(file, 'project-1', 'Large Video')
    })

    await waitFor(() => {
      // Status changes to uploading after initiate
      expect(result.current.files[0]?.status).toBe('uploading')
    })

    // Cancel the upload
    vi.mocked(api.post).mockResolvedValue({}) // for abort call
    await act(async () => {
      await result.current.cancelUpload(fileId!)
    })

    expect(result.current.files[0]?.status).toBe('cancelled')
  })

  it('removeFile removes file from list', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('fail'))

    const { result } = renderHook(() => useUpload())
    const file = createMockFile()

    act(() => {
      result.current.startUpload(file, 'project-1', 'Test')
    })

    await waitFor(() => {
      expect(result.current.files).toHaveLength(1)
    })

    const fileId = result.current.files[0]?.id!
    act(() => {
      result.current.removeFile(fileId)
    })

    expect(result.current.files).toHaveLength(0)
  })

  it('clearCompleted removes only completed files', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ upload_id: 'u1', asset_id: 'a1', version_id: 'v1' })
      .mockResolvedValueOnce({ url: 'https://s3.example.com' })
      .mockResolvedValueOnce({})

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '"etag"' },
    }))

    const { result } = renderHook(() => useUpload())
    const file = createMockFile('small.mp4', 5 * 1024 * 1024)

    act(() => {
      result.current.startUpload(file, 'project-1', 'Test')
    })

    await waitFor(() => {
      expect(result.current.files[0]?.status).toBe('complete')
    })

    act(() => {
      result.current.clearCompleted()
    })

    expect(result.current.files).toHaveLength(0)
  })
})
