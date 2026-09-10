/**
 * In-process operational metrics (Phase 4 §23). No external metrics
 * backend is wired up yet — this is a small in-memory counter/latency
 * tracker that an admin dashboard endpoint reads directly. It resets on
 * restart, which is fine for a pilot: real Phase 5 production monitoring
 * (Prometheus/Datadog/etc.) will replace this, not extend it.
 */

export type FailureCategory =
  | "api_errors"
  | "db_errors"
  | "payment_errors"
  | "notification_failures"
  | "location_failures"
  | "matching_failures"

const counters: Record<FailureCategory, number> = {
  api_errors: 0,
  db_errors: 0,
  payment_errors: 0,
  notification_failures: 0,
  location_failures: 0,
  matching_failures: 0,
}

const MAX_LATENCY_SAMPLES = 500
const requestLatenciesMs: number[] = []
const startedAt = Date.now()
let requestCount = 0

export function recordFailure(category: FailureCategory, meta?: Record<string, unknown>) {
  counters[category]++
  if (meta) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", message: `observability:${category}`, ...meta }))
  }
}

export function recordRequestLatency(ms: number) {
  requestCount++
  requestLatenciesMs.push(ms)
  if (requestLatenciesMs.length > MAX_LATENCY_SAMPLES) requestLatenciesMs.shift()
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

export function observabilitySnapshot() {
  const sorted = [...requestLatenciesMs].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requestCount,
    latencyMs: {
      sampleSize: sorted.length,
      avg: sorted.length ? Math.round(sum / sorted.length) : 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
    },
    failures: { ...counters },
  }
}
