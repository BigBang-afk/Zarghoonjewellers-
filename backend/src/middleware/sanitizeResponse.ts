import type { NextFunction, Request, Response } from "express"

/**
 * Defense-in-depth against sensitive-field leakage (Phase 3 §29 security
 * review). Many endpoints legitimately `include: { user: true }` (or
 * similar) to surface a name/phone/rating alongside a ride/offer/dispute
 * — but Prisma's `include` returns every scalar column, including
 * `passwordHash` and `tokenHash`. Rather than rely on every call site
 * remembering to `select` around them (and every future one), this
 * strips a fixed blocklist of field names from every JSON response
 * before it leaves the process, however deeply nested.
 */
const SENSITIVE_KEYS = new Set(["passwordHash", "tokenHash"])

function scrub<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(scrub) as unknown as T
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) continue
      out[key] = scrub(val)
    }
    return out as T
  }
  return value
}

export function sanitizeResponse(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res)
  res.json = ((body: unknown) => originalJson(scrub(body))) as Response["json"]
  next()
}
