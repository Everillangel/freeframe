import { getAccessToken, refreshAccessToken } from './auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

interface RequestOptions {
  headers?: Record<string, string>
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const buildHeaders = (token: string | null): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  const execute = async (token: string | null): Promise<Response> => {
    return fetch(`${API_URL}${path}`, {
      method,
      headers: buildHeaders(token),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let token = getAccessToken()
  let response = await execute(token)

  // On 401, attempt a token refresh and retry once
  if (response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      response = await execute(newToken)
    }
  }

  if (!response.ok) {
    let detail = response.statusText
    try {
      const errorBody = await response.json()
      if (errorBody?.detail) {
        detail =
          typeof errorBody.detail === 'string'
            ? errorBody.detail
            : JSON.stringify(errorBody.detail)
      }
    } catch {
      // ignore parse errors; use statusText as fallback
    }
    throw new ApiError(response.status, detail)
  }

  // Handle empty responses (e.g. 204 No Content)
  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>('GET', path, undefined, options),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
}

export type { ApiError as ApiErrorType }
