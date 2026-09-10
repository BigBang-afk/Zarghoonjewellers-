import { createServer } from "node:http"
import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { initSocket } from "./realtime/socket.js"
import { sweepExpiredNegotiations } from "./services/negotiationEngine.js"
import { dispatchDueScheduledRides } from "./services/scheduledRideService.js"
import { sweepDocumentExpirations } from "./services/verificationService.js"
import { logger } from "./utils/logger.js"

const app = createApp()
const httpServer = createServer(app)
initSocket(httpServer)

// MVP timer mechanism for offer/counter-offer/request expiry (docs/06 §4).
// A production deployment would move this to a durable job scheduler;
// an in-process interval is sufficient for a single backend instance.
const SWEEP_INTERVAL_MS = 5_000
setInterval(() => {
  sweepExpiredNegotiations().catch((err) => {
    logger.error("negotiation_sweep_failed", { message: err instanceof Error ? err.message : String(err) })
  })
}, SWEEP_INTERVAL_MS)

// Scheduled-ride dispatch (Phase 2 §13) — checked less frequently since
// lead time is measured in minutes, not seconds.
const SCHEDULED_RIDE_SWEEP_INTERVAL_MS = 60_000
setInterval(() => {
  dispatchDueScheduledRides().catch((err) => {
    logger.error("scheduled_ride_sweep_failed", { message: err instanceof Error ? err.message : String(err) })
  })
}, SCHEDULED_RIDE_SWEEP_INTERVAL_MS)

// Document-expiration sweep (Phase 3 §17) — measured in days, so an
// hourly cadence is more than enough responsiveness.
const DOCUMENT_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60_000
setInterval(() => {
  sweepDocumentExpirations().catch((err) => {
    logger.error("document_expiry_sweep_failed", { message: err instanceof Error ? err.message : String(err) })
  })
}, DOCUMENT_EXPIRY_SWEEP_INTERVAL_MS)

httpServer.listen(env.port, () => {
  logger.info("server_started", { port: env.port, env: env.nodeEnv })
})
