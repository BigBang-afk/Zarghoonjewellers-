import express from "express"
import cors from "cors"
import helmet from "helmet"
import { env } from "./config/env.js"
import { generalRateLimit } from "./middleware/rateLimit.js"
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js"
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

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.corsOrigin, credentials: true }))
  app.use(express.json({ limit: "1mb" }))
  app.use(generalRateLimit)

  app.get("/health", (_req, res) => res.json({ ok: true, service: "rivo-backend", env: env.nodeEnv }))

  app.use("/v1/auth", authRouter)
  app.use("/v1/passenger", passengerRouter)
  app.use("/v1/driver", driverRouter)
  app.use("/v1", ridesRouter) // /ride-requests, /ride-offers, /counter-offers, /rides, /fare-estimates
  app.use("/v1/admin", adminRouter)
  app.use("/v1/safety", safetyRouter)
  app.use("/v1/public", publicSafetyRouter)
  app.use("/v1/public", publicRouter)
  app.use("/v1/notifications", notificationsRouter)
  app.use("/v1/account", accountRouter)
  app.use("/v1/business", businessRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
