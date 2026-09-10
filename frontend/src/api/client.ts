import { config } from "../config/env"
import { tokenStore } from "../auth/tokenStore"

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.getRefreshToken()
  if (!refreshToken) return false
  if (!refreshPromise) {
    refreshPromise = fetch(`${config.apiUrl}/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false
        const data = await res.json()
        tokenStore.setTokens(data.accessToken, data.refreshToken)
        return true
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  auth?: boolean // default true
  query?: Record<string, string | number | boolean | undefined>
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  const { method = "GET", body, auth = true, query } = options

  let url = `${config.apiUrl}${path}`
  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (auth) {
    const token = tokenStore.getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })

  if (res.status === 401 && auth && !_retried) {
    const refreshed = await tryRefresh()
    if (refreshed) return apiRequest<T>(path, options, true)
    tokenStore.clear()
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const err = data?.error ?? { code: "UNKNOWN_ERROR", message: "Something went wrong." }
    throw new ApiError(res.status, err.code, err.message, err.details)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => apiRequest<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: Partial<RequestOptions>) => apiRequest<T>(path, { method: "POST", body, ...opts }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "DELETE", body }),
}
