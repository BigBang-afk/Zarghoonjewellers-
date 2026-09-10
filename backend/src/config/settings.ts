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
