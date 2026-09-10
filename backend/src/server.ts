import { createServer } from "node:http"
import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { initSocket } from "./realtime/socket.js"
import { sweepExpiredNegotiations } from "./services/negotiationEngine.js"
import { dispatchDueScheduledRides } from "./services/scheduledRideService.js"
import { sweepDocumentExpirations } from "./services/verificationService.js"

const app = createApp()
const httpServer = createServer(app)
initSocket(httpServer)

// MVP timer mechanism for offer/counter-offer/request expiry (docs/06 §4).
// A production deployment would move this to a durable job scheduler;
// an in-process interval is sufficient for a single backend instance.
const SWEEP_INTERVAL_MS = 5_000
setInterval(() => {
  sweepExpiredNegotiations().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Negotiation sweep failed:", err)
  })
}, SWEEP_INTERVAL_MS)

// Scheduled-ride dispatch (Phase 2 §13) — checked less frequently since
// lead time is measured in minutes, not seconds.
const SCHEDULED_RIDE_SWEEP_INTERVAL_MS = 60_000
setInterval(() => {
  dispatchDueScheduledRides().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Scheduled ride dispatch sweep failed:", err)
  })
}, SCHEDULED_RIDE_SWEEP_INTERVAL_MS)

// Document-expiration sweep (Phase 3 §17) — measured in days, so an
// hourly cadence is more than enough responsiveness.
const DOCUMENT_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60_000
setInterval(() => {
  sweepDocumentExpirations().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Document expiration sweep failed:", err)
  })
}, DOCUMENT_EXPIRY_SWEEP_INTERVAL_MS)

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`RIVO backend listening on http://localhost:${env.port} (${env.nodeEnv})`)
})
