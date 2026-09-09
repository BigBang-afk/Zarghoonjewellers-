import { createServer } from "node:http"
import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { initSocket } from "./realtime/socket.js"
import { sweepExpiredNegotiations } from "./services/negotiationEngine.js"

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

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`RIVO backend listening on http://localhost:${env.port} (${env.nodeEnv})`)
})
