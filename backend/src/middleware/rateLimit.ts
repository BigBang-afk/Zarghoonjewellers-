import rateLimit from "express-rate-limit"
import { env } from "../config/env.js"

// Rate limiting is disabled under automated tests (NODE_ENV=test) so a
// suite that legitimately logs in as many different seeded accounts
// doesn't trip the same per-IP limiter a single real client would hit.
const skip = () => env.nodeEnv === "test"

/** Tighter limiter for auth/OTP endpoints — prevents OTP abuse (docs/06 §7). */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
})

/** Prevents ride-request spam (docs/06 §7). */
export const rideRequestRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: { code: "RATE_LIMITED", message: "Too many ride requests. Slow down and try again." } },
})

/** General API limiter — generous, just a backstop. */
export const generalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
})
