import express from "express"
import cors from "cors"
import helmet from "helmet"
import { env } from "./config/env.js"
import { generalRateLimit } from "./middleware/rateLimit.js"
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js"
import { sanitizeResponse } from "./middleware/sanitizeResponse.js"
import { requestLogging } from "./middleware/requestLogging.js"
import { prisma } from "./utils/prisma.js"
import { authRouter } from "./api/auth/router.js"
import { passengerRouter } from "./api/passenger/router.js"
import { driverRouter } from "./api/driver/router.js"
import { ridesRouter } from "./api/rides/router.js"
import { adminRouter } from "./api/admin/router.js"
import { safetyRouter, publicSafetyRouter } from "./api/safety/router.js"
import { notificationsRouter } from "./api/notifications/router.js"
import { publicRouter } from "./api/public/router.js"
import { accountRouter } from "./api/account/router.js"
import { businessRouter } from "./api/business/router.js"
import { supportRouter } from "./api/support/router.js"
import { webhooksRouter } from "./api/public/webhooks.js"

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.corsOrigin, credentials: true }))
  // `verify` stashes the exact raw bytes on req.rawBody for every request
  // (cheap — just a buffer reference) so the payment-webhook route can
  // verify a provider's signature against the real wire bytes rather than
  // a re-serialized JSON.stringify(req.body), which a stray key-order or
  // whitespace difference would silently break (Phase 4 §4).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        ;(req as express.Request & { rawBody?: Buffer }).rawBody = buf
      },
    }),
  )
  app.use(requestLogging)
  app.use(generalRateLimit)
  app.use(sanitizeResponse)

  // Liveness — process is up, no dependency checks (Phase 4 §23).
  app.get("/health", (_req, res) => res.json({ ok: true, service: "rivo-backend", env: env.nodeEnv }))

  // Readiness — can this instance actually serve traffic right now (DB reachable)?
  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ ok: true, checks: { database: "up" } })
    } catch {
      res.status(503).json({ ok: false, checks: { database: "down" } })
    }
  })

  // More specific mounts must come before the bare "/v1" mount below —
  // Express matches app.use() prefixes in registration order, and
  // ridesRouter's blanket `requireAuth` would otherwise intercept every
  // request under "/v1/*" (including the intentionally unauthenticated
  // /v1/public/* routes) before it ever reaches its real router.
  app.use("/v1/auth", authRouter)
  app.use("/v1/passenger", passengerRouter)
  app.use("/v1/driver", driverRouter)
  app.use("/v1/admin", adminRouter)
  app.use("/v1/safety", safetyRouter)
  app.use("/v1/public", publicSafetyRouter)
  app.use("/v1/public", publicRouter)
  app.use("/v1/public/webhooks", webhooksRouter)
  app.use("/v1/notifications", notificationsRouter)
  app.use("/v1/account", accountRouter)
  app.use("/v1/business", businessRouter)
  app.use("/v1/support", supportRouter)
  app.use("/v1", ridesRouter) // /ride-requests, /ride-offers, /counter-offers, /rides, /fare-estimates

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
