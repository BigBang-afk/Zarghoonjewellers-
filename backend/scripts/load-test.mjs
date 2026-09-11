#!/usr/bin/env node
// Phase 5 §26 — load testing foundation. docs/19-performance-targets.md §6
// explicitly deferred this: "not done here... that's Phase 5 scope." This
// is that tool: a dependency-free Node script that drives concurrent
// traffic against a running instance and reports client-observed latency
// alongside the server's own GET /admin/observability snapshot, so the
// two can be cross-checked against each other.
//
// This is a SANDBOX/DEV-SCALE tool run against SQLite on a single
// container — never present its numbers as a production capacity claim.
// docs/19-performance-targets.md §6 still names the right tool for real
// pre-launch capacity testing (k6/Artillery against a staging Postgres
// environment); this script is for day-to-day regression checking during
// development, not a replacement for that.
//
// Usage:
//   node scripts/load-test.mjs [--base-url=http://localhost:4000/v1]
//     [--duration=30] [--concurrency=10] [--rps=4]
//     [--passenger-phone=+923001000001] [--passenger-password=Passenger123!]
//     [--admin-phone=+923000000001] [--admin-password=Admin123!]
//
// --rps paces the total request rate (default 4/s = 240/min) — without
// pacing, even a handful of concurrent workers in a tight loop fire
// thousands of req/s on localhost and instantly exhaust the general API
// limiter (300 req/min/IP, middleware/rateLimit.ts) before a single
// request reaches a route handler, measuring the rate limiter's rejection
// path instead of real endpoint latency. Pass a higher --rps deliberately
// to characterize that limiter itself, or raise/disable it server-side
// for a dedicated single-IP capacity run.
//
// Scenarios hit (weighted), all safe to repeat without polluting state:
//   - GET  /public/cities              (unauthenticated read)
//   - POST /fare-estimates             (passenger, pure computation — no ride/DB row created)
//   - GET  /admin/dashboard/kpis       (admin, multi-aggregate read)

import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const resultsDir = path.resolve(here, "../load-test-results")

function arg(name, fallback) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

const baseUrl = arg("base-url", "http://localhost:4000/v1")
const durationSec = Number(arg("duration", "30"))
const concurrency = Number(arg("concurrency", "10"))
const targetRps = Number(arg("rps", "4"))
const delayPerWorkerMs = (concurrency / targetRps) * 1000
const passengerPhone = arg("passenger-phone", "+923001000001")
const passengerPassword = arg("passenger-password", "Passenger123!")
const adminPhone = arg("admin-phone", "+923000000001")
const adminPassword = arg("admin-password", "Admin123!")

async function login(phone, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  })
  if (!res.ok) throw new Error(`Login failed for ${phone}: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.accessToken
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    count: sorted.length,
    avgMs: sorted.length ? Math.round(sum / sorted.length) : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
  }
}

async function main() {
  console.log(`Load test against ${baseUrl} — ${concurrency} concurrent workers, paced to ~${targetRps} req/s, for ${durationSec}s`)
  console.log("Logging in as seeded passenger and admin accounts...")
  const [passengerToken, adminToken] = await Promise.all([login(passengerPhone, passengerPassword), login(adminPhone, adminPassword)])

  const citiesRes = await fetch(`${baseUrl}/public/cities`)
  const { cities } = await citiesRes.json()
  if (cities.length === 0) throw new Error("No live cities found — seed the database first.")
  const city = cities[0]

  const vehicleTypesRes = await fetch(`${baseUrl}/public/vehicle-types?cityId=${city.id}`)
  const { vehicleTypes } = await vehicleTypesRes.json()
  if (vehicleTypes.length === 0) throw new Error(`No vehicle types found for city ${city.name} — seed the database first.`)
  const vehicleType = vehicleTypes[0]

  // Small jitter around a fixed Lahore-area point so fare estimates vary
  // slightly between iterations without needing real geocoding.
  function jitteredPoint(baseLat, baseLng) {
    return { lat: baseLat + (Math.random() - 0.5) * 0.05, lng: baseLng + (Math.random() - 0.5) * 0.05 }
  }

  const scenarios = [
    {
      name: "public_cities",
      weight: 3,
      run: async () => {
        const res = await fetch(`${baseUrl}/public/cities`)
        return res.status
      },
    },
    {
      name: "fare_estimate",
      weight: 5,
      run: async () => {
        const res = await fetch(`${baseUrl}/fare-estimates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${passengerToken}` },
          body: JSON.stringify({
            cityId: city.id,
            vehicleTypeId: vehicleType.id,
            pickup: jitteredPoint(31.5204, 74.3587),
            destination: jitteredPoint(31.47, 74.38),
          }),
        })
        return res.status
      },
    },
    {
      name: "admin_kpis",
      weight: 2,
      run: async () => {
        const res = await fetch(`${baseUrl}/admin/dashboard/kpis`, { headers: { Authorization: `Bearer ${adminToken}` } })
        return res.status
      },
    },
  ]
  const weightedPool = scenarios.flatMap((s) => Array(s.weight).fill(s))

  const samples = Object.fromEntries(scenarios.map((s) => [s.name, []]))
  let successCount = 0
  // Bucketed separately from other errors: express-rate-limit's 429 means
  // "the general API limiter (300 req/min per IP, middleware/rateLimit.ts)
  // is working as designed," not a server failure — a naive single-IP
  // load test at real concurrency will hit this ceiling almost
  // immediately, and lumping it in with 5xx failures would misrepresent
  // an intentional safeguard as an outage.
  let rateLimitedCount = 0
  let errorCount = 0
  const errors = []

  const stopAt = Date.now() + durationSec * 1000

  async function worker() {
    while (Date.now() < stopAt) {
      const scenario = weightedPool[Math.floor(Math.random() * weightedPool.length)]
      const start = performance.now()
      try {
        const status = await scenario.run()
        const elapsed = performance.now() - start
        if (status >= 200 && status < 300) {
          samples[scenario.name].push(elapsed)
          successCount++
        } else if (status === 429) {
          rateLimitedCount++
        } else {
          errorCount++
          errors.push(`${scenario.name}: HTTP ${status}`)
        }
      } catch (err) {
        errorCount++
        errors.push(`${scenario.name}: ${err.message}`)
      }
      if (delayPerWorkerMs > 0) await new Promise((r) => setTimeout(r, delayPerWorkerMs))
    }
  }

  const startedAt = Date.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const actualDurationSec = (Date.now() - startedAt) / 1000

  const totalRequests = successCount + rateLimitedCount + errorCount
  const report = {
    config: { baseUrl, durationSec, concurrency, targetRps },
    note: "Dev-sandbox run against SQLite on a single container — not a production capacity benchmark. See docs/19-performance-targets.md §6.",
    ranAt: new Date().toISOString(),
    actualDurationSec: Math.round(actualDurationSec * 10) / 10,
    totalRequests,
    requestsPerSec: Math.round((totalRequests / actualDurationSec) * 10) / 10,
    successCount,
    rateLimitedCount,
    rateLimitedNote:
      rateLimitedCount > 0
        ? "Non-zero: the general API limiter (300 req/min/IP) rejected requests before they reached a route handler — expected at this concurrency from a single IP, not a server failure. Lower --concurrency or raise the limiter for a single-IP capacity run."
        : undefined,
    errorCount,
    errorRatePct: totalRequests ? Math.round((errorCount / totalRequests) * 1000) / 10 : 0,
    sampleErrors: [...new Set(errors)].slice(0, 5),
    byScenario: Object.fromEntries(scenarios.map((s) => [s.name, summarize(samples[s.name])])),
  }

  console.log("\n--- Client-observed results ---")
  console.log(JSON.stringify(report, null, 2))

  try {
    const obsRes = await fetch(`${baseUrl}/admin/observability`, { headers: { Authorization: `Bearer ${adminToken}` } })
    if (obsRes.ok) {
      report.serverObservabilitySnapshot = await obsRes.json()
      console.log("\n--- Server-side observability snapshot (GET /admin/observability) ---")
      console.log(JSON.stringify(report.serverObservabilitySnapshot, null, 2))
    }
  } catch {
    // Non-fatal — the client-side report above still stands on its own.
  }

  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const outPath = path.join(resultsDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\nFull report written to ${outPath}`)

  if (report.errorRatePct > 5) {
    console.error(`\nError rate ${report.errorRatePct}% exceeds 5% — treating this run as failed.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Load test failed:", err)
  process.exit(1)
})
