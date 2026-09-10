import rateLimit from "express-rate-limit"
import { env } from "../config/env.js"
import { getSetting, SETTINGS_DEFAULTS, type PlatformSettingsShape } from "../config/settings.js"

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

/** No-auth public form (waitlist) — prevents scripted bulk submission. */
export const publicFormRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: { code: "RATE_LIMITED", message: "Too many submissions. Try again later." } },
})

/**
 * Admin-configurable rate limiters (Phase 4 §27) — the window is fixed at
 * process start (express-rate-limit's `windowMs` can't be a function),
 * but the cap itself reads live from PlatformSetting on every request via
 * `getSetting()`, so an admin can tighten/loosen a limit without a
 * redeploy. `windowSecKey`'s DEFAULTS value seeds the fixed window.
 */
function configurableRateLimit(
  limitKey: keyof PlatformSettingsShape,
  windowSecKey: keyof PlatformSettingsShape,
  message: string,
) {
  return rateLimit({
    windowMs: (SETTINGS_DEFAULTS[windowSecKey] as number) * 1000,
    limit: async () => (await getSetting(limitKey)) as number,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    message: { error: { code: "RATE_LIMITED", message } },
  })
}

/** Offer/counter-offer accept/counter/decline (Phase 4 §27). */
export const offerActionRateLimit = configurableRateLimit(
  "rateLimit.offerAction.limit",
  "rateLimit.offerAction.windowSec",
  "Too many offer actions. Slow down and try again.",
)

/** Ride chat messages. */
export const chatRateLimit = configurableRateLimit(
  "rateLimit.chat.limit",
  "rateLimit.chat.windowSec",
  "Too many messages sent. Slow down and try again.",
)

/** Referral code application — abuse prevention on top of the DB-level check. */
export const referralRateLimit = configurableRateLimit(
  "rateLimit.referral.limit",
  "rateLimit.referral.windowSec",
  "Too many referral attempts. Try again later.",
)

/** Promo-code validation — prevents brute-forcing valid codes. */
export const promoRedemptionRateLimit = configurableRateLimit(
  "rateLimit.promoRedemption.limit",
  "rateLimit.promoRedemption.windowSec",
  "Too many promo code attempts. Try again later.",
)

/** Self-service payment endpoints (wallet top-up). */
export const paymentRateLimit = configurableRateLimit(
  "rateLimit.payment.limit",
  "rateLimit.payment.windowSec",
  "Too many payment attempts. Try again later.",
)
