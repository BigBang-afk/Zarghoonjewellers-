import { logger } from "../utils/logger.js"

interface JobDefinition {
  name: string
  intervalMs: number
  handler: () => Promise<void>
}

const runningJobs = new Set<string>()

/**
 * Background job registry (Phase 4 §28). An in-process `setInterval` is
 * still the mechanism (a single-instance MVP has no need for a durable
 * queue yet — see the module doc in server.ts), but every job now goes
 * through one place that gives it three things uniformly: an overlap
 * guard (a slow tick is skipped rather than run twice — the retry-safe/
 * idempotent contract means skipping a tick is always safe, the next
 * tick picks up whatever's still due), structured start/failure logging,
 * and consistent error isolation so one job's exception can never take
 * down another job's timer or the process.
 */
export function registerJob(def: JobDefinition): NodeJS.Timeout {
  const run = async () => {
    if (runningJobs.has(def.name)) return
    runningJobs.add(def.name)
    const startedAt = Date.now()
    try {
      await def.handler()
      logger.debug("job_completed", { job: def.name, durationMs: Date.now() - startedAt })
    } catch (err) {
      logger.error("job_failed", { job: def.name, durationMs: Date.now() - startedAt, message: err instanceof Error ? err.message : String(err) })
    } finally {
      runningJobs.delete(def.name)
    }
  }
  return setInterval(run, def.intervalMs)
}
