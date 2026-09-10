import { prisma } from "../utils/prisma.js"

/**
 * Platform-wide, admin-configurable settings — backed by the
 * `platform_settings` table (editable from Admin → Settings). Every value
 * that Phase 2 explicitly calls out as "do not hard-code" lives here, with
 * an in-code default used only until an admin (or the seed script)
 * writes a row.
 *
 * Reads are cached in-process for a few seconds to avoid a DB round trip
 * on every request in hot paths (matching, fare calc) while still picking
 * up admin edits quickly.
 */

export interface PlatformSettingsShape {
  "matching.initialRadiusKm": number
  "matching.radiusExpansionStepsKm": number[]
  "matching.maxRadiusKm": number
  "matching.quickMatchDispatchTimeoutSec": number
  "matching.competitiveOfferMaxDrivers": number
  "negotiation.offerExpirySec": number
  "negotiation.counterOfferExpirySec": number
  "negotiation.requestExpiryMinutes": number
  "fare.defaultCommissionRate": number
  "fare.demandMultiplierMin": number
  "fare.demandMultiplierMax": number
  "fare.rangeSpreadPct": number

  // Phase 3 — smart matching weights (must sum to ~1.0; not enforced, just documented)
  "matching.weightEta": number
  "matching.weightAcceptance": number
  "matching.weightRating": number
  "matching.weightFairness": number
  "matching.locationStalenessMinutes": number
  "matching.favoriteDriverBoost": number

  // Phase 3 — negotiation guardrails
  "negotiation.maxCounterRounds": number
  "negotiation.maxCounterDeviationPct": number

  // Phase 3 — referrals
  "referral.rewardAmountReferrer": number
  "referral.rewardAmountReferred": number
  "referral.qualifyingRideCount": number

  // Phase 3 — verification / documents
  "verification.documentExpiryWarningDays": number

  // Phase 3 — risk signals
  "risk.cancellationRateThresholdPct": number
  "risk.minRidesForCancellationCheck": number
  "risk.impossibleSpeedKmh": number

  // Phase 3 — scheduled rides
  "scheduledRide.dispatchLeadMinutes": number

  // Phase 4 §6 — map provider selection is informational until a second
  // provider class is registered in services/maps/; §7 — dispatch retry cap
  "maps.poorAccuracyThresholdM": number
  "matching.maxDispatchHops": number

  // Phase 4 §27 — per-category rate limits (window in seconds, cap per
  // window per client IP). Login/OTP already had a dedicated limiter from
  // Phase 1; these round out the rest of the abuse surface named in the
  // spec: offer/counter-offer actions, ride chat, referral redemption,
  // promo-code validation, and self-service wallet top-up.
  "rateLimit.offerAction.windowSec": number
  "rateLimit.offerAction.limit": number
  "rateLimit.chat.windowSec": number
  "rateLimit.chat.limit": number
  "rateLimit.referral.windowSec": number
  "rateLimit.referral.limit": number
  "rateLimit.promoRedemption.windowSec": number
  "rateLimit.promoRedemption.limit": number
  "rateLimit.payment.windowSec": number
  "rateLimit.payment.limit": number

  // Phase 4 §37 — Pilot Mode. Zone/vehicle-type scoping is already covered
  // by ServiceZone/CityVehicleType.isActive and City.status, so this only
  // adds what those don't: an on/off switch, driver/passenger supply caps
  // for the pilot city, and whether registration requires an invitation
  // code. 0 for either cap means "no cap enforced".
  "pilotMode.enabled": boolean
  "pilotMode.cityId": string
  "pilotMode.maxDriverCount": number
  "pilotMode.maxPassengerCount": number
  "pilotMode.requireInvitationCode": boolean

  // Phase 4 §36 — no real payment-provider fee data exists anywhere in
  // this system (the mock providers charge nothing), so unit economics
  // can only estimate processing cost from an admin-entered rate rather
  // than pretend it's measured. Every place that uses this labels the
  // resulting figure "estimate", never "actual".
  "finance.estimatedPaymentProcessingFeePct": number

  // Phase 5 §8 — customer retention engine. Days-since-last-ride thresholds
  // for each lifecycle nudge, plus a cooldown so the periodic sweep never
  // re-sends the same nudge to a still-inactive user every time it runs.
  "retention.secondRideNudgeAfterDays": number
  "retention.inactive7dAfterDays": number
  "retention.inactive30dAfterDays": number
  "retention.resendCooldownDays": number
  /** Percentage off, applied via a real single-use Promotion generated at send time — never just claimed in copy. */
  "retention.winbackDiscountPct": number
  "retention.winbackDiscountValidDays": number

  // Phase 5 §10 — supply/demand dashboard traffic-light thresholds. A
  // cell/zone's open-requests-to-available-drivers ratio at or below
  // greenMaxRatio is healthy; above that up to yellowMaxRatio is a
  // caution; above yellowMaxRatio is red. Configurable, never hard-coded.
  "supplyDemand.greenMaxRatio": number
  "supplyDemand.yellowMaxRatio": number

  // Phase 5 §13 — advanced dispatch staging. findEligibleDrivers() already
  // walks matching.radiusExpansionStepsKm ("closest eligible" -> "expand
  // radius"); once that's exhausted with zero candidates, "expand pool"
  // is a last, explicitly-labeled tier that widens the candidate pool
  // itself (allowing staler driver locations) instead of trying yet
  // another radius. Must be >= matching.locationStalenessMinutes or it
  // has no effect.
  "matching.expandPoolStalenessMinutes": number

  // Phase 5 §14 — smart cancellation management. Off by default ("no
  // automatic penalties without configurable policy"): an admin must
  // explicitly enable penaltyEnabled before any fee is ever charged. Even
  // when enabled, a cancellation within freeWindowSec of booking, or for
  // a reason attributable to the other party (see
  // EXEMPT_*_CANCELLATION_REASONS), is never fee-eligible.
  "cancellation.penaltyEnabled": boolean
  "cancellation.freeWindowSec": number
  "cancellation.passengerFeeAmount": number
}

const DEFAULTS: PlatformSettingsShape = {
  "matching.initialRadiusKm": 5,
  "matching.radiusExpansionStepsKm": [5, 8, 12, 20],
  "matching.maxRadiusKm": 20,
  "matching.quickMatchDispatchTimeoutSec": 20,
  "matching.competitiveOfferMaxDrivers": 8,
  "negotiation.offerExpirySec": 90,
  "negotiation.counterOfferExpirySec": 90,
  "negotiation.requestExpiryMinutes": 5,
  "fare.defaultCommissionRate": 0.15,
  "fare.demandMultiplierMin": 1.0,
  "fare.demandMultiplierMax": 2.5,
  "fare.rangeSpreadPct": 0.12,

  "matching.weightEta": 0.4,
  "matching.weightAcceptance": 0.25,
  "matching.weightRating": 0.25,
  "matching.weightFairness": 0.1,
  "matching.locationStalenessMinutes": 10,
  "matching.favoriteDriverBoost": 25,

  "negotiation.maxCounterRounds": 2,
  "negotiation.maxCounterDeviationPct": 0.3,

  "referral.rewardAmountReferrer": 200,
  "referral.rewardAmountReferred": 100,
  "referral.qualifyingRideCount": 1,

  "verification.documentExpiryWarningDays": 30,

  "risk.cancellationRateThresholdPct": 30,
  "risk.minRidesForCancellationCheck": 5,
  "risk.impossibleSpeedKmh": 150,

  "scheduledRide.dispatchLeadMinutes": 15,

  "maps.poorAccuracyThresholdM": 100,
  "matching.maxDispatchHops": 5,

  "rateLimit.offerAction.windowSec": 60,
  "rateLimit.offerAction.limit": 20,
  "rateLimit.chat.windowSec": 60,
  "rateLimit.chat.limit": 30,
  "rateLimit.referral.windowSec": 3600,
  "rateLimit.referral.limit": 5,
  "rateLimit.promoRedemption.windowSec": 300,
  "rateLimit.promoRedemption.limit": 10,
  "rateLimit.payment.windowSec": 300,
  "rateLimit.payment.limit": 10,

  "pilotMode.enabled": false,
  "pilotMode.cityId": "",
  "pilotMode.maxDriverCount": 0,
  "pilotMode.maxPassengerCount": 0,
  "pilotMode.requireInvitationCode": false,

  "finance.estimatedPaymentProcessingFeePct": 2.9,

  "retention.secondRideNudgeAfterDays": 3,
  "retention.inactive7dAfterDays": 7,
  "retention.inactive30dAfterDays": 30,
  "retention.resendCooldownDays": 14,
  "retention.winbackDiscountPct": 20,
  "retention.winbackDiscountValidDays": 14,

  "supplyDemand.greenMaxRatio": 0.8,
  "supplyDemand.yellowMaxRatio": 1.5,

  "matching.expandPoolStalenessMinutes": 25,

  "cancellation.penaltyEnabled": false,
  "cancellation.freeWindowSec": 120,
  "cancellation.passengerFeeAmount": 50,
}

const CACHE_TTL_MS = 5_000
let cache: Partial<PlatformSettingsShape> | null = null
let cacheLoadedAt = 0

async function loadFromDb(): Promise<Partial<PlatformSettingsShape>> {
  const rows = await prisma.platformSetting.findMany()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
    } catch {
      // corrupt/manual edit — ignore and fall back to default for this key
    }
  }
  return out as Partial<PlatformSettingsShape>
}

async function ensureCache(): Promise<void> {
  const now = Date.now()
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return
  cache = await loadFromDb()
  cacheLoadedAt = now
}

export async function getSetting<K extends keyof PlatformSettingsShape>(
  key: K,
): Promise<PlatformSettingsShape[K]> {
  await ensureCache()
  return (cache?.[key] as PlatformSettingsShape[K] | undefined) ?? DEFAULTS[key]
}

export async function getAllSettings(): Promise<PlatformSettingsShape> {
  await ensureCache()
  return { ...DEFAULTS, ...cache }
}

export async function setSetting<K extends keyof PlatformSettingsShape>(
  key: K,
  value: PlatformSettingsShape[K],
  description?: string,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value), description },
    update: { value: JSON.stringify(value), ...(description ? { description } : {}) },
  })
  cache = null // force reload on next read
}

export function invalidateSettingsCache(): void {
  cache = null
}

export const SETTINGS_DEFAULTS = DEFAULTS
