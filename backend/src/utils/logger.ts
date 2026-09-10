/**
 * Structured (JSON-line) logging (Phase 4 §23). Every log line is a single
 * JSON object with a timestamp and level, so a production log shipper can
 * parse it without regex. `redact()` strips known-sensitive keys before
 * anything is serialized — never log passwords, tokens, or payment
 * credentials, even if a caller accidentally hands them in `meta`.
 */
type LogLevel = "debug" | "info" | "warn" | "error"

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "newpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "resettoken",
  "secret",
  "authorization",
  "otp",
  "code",
  "cardnumber",
  "cvv",
  "pin",
  "webhooksecret",
  "signature",
])

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redact(val, depth + 1)
    }
    return out
  }
  return value
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  }
  // eslint-disable-next-line no-console
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log
  sink(JSON.stringify(line))
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
}
