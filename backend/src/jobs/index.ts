import { registerJob } from "./registry.js"
import { sweepExpiredNegotiations } from "../services/negotiationEngine.js"
import { dispatchDueScheduledRides } from "../services/scheduledRideService.js"
import { sweepDocumentExpirations } from "../services/verificationService.js"
import { reconcileStuckPayments } from "./paymentReconciliationJob.js"
import { runCleanupSweep } from "./cleanupJob.js"
import { runRetentionSweep } from "../services/retentionService.js"

/**
 * Every recurring background job (Phase 4 §28), started once from
 * server.ts. An in-process interval is still the mechanism — a durable
 * queue (BullMQ/etc.) is real Phase 5 scope for a multi-instance
 * deployment, not something a single-instance pilot needs — but every
 * job now goes through registerJob(), which gives all of them the same
 * overlap guard and structured logging (see registry.ts).
 */
export function startBackgroundJobs(): void {
  // Offer/counter-offer/request expiry (docs/06 §4) — seconds-scale, so it
  // runs often.
  registerJob({ name: "negotiation_sweep", intervalMs: 5_000, handler: sweepExpiredNegotiations })

  // Scheduled-ride dispatch (Phase 2 §13) — lead time is minutes, not seconds.
  registerJob({ name: "scheduled_ride_dispatch", intervalMs: 60_000, handler: dispatchDueScheduledRides })

  // Document-expiration reminders (Phase 3 §17) — days-scale.
  registerJob({ name: "document_expiry_sweep", intervalMs: 60 * 60_000, handler: sweepDocumentExpirations })

  // Payment reconciliation (Phase 4 §28) — catches a Payment stuck
  // pending/authorized past its own 10-minute threshold, so no need to
  // run more often than that.
  registerJob({ name: "payment_reconciliation", intervalMs: 5 * 60_000, handler: reconcileStuckPayments })

  // Cleanup sweep (Phase 4 §28) — expired refresh tokens / stale OTP codes.
  registerJob({ name: "cleanup_sweep", intervalMs: 60 * 60_000, handler: runCleanupSweep })

  // Customer retention engine (Phase 5 §8) — second-ride/7d/30d nudges.
  // Days-scale thresholds, so hourly is plenty frequent; the per-campaign
  // cooldown (not this interval) is what actually controls resend cadence.
  registerJob({ name: "retention_sweep", intervalMs: 60 * 60_000, handler: runRetentionSweep })
}
