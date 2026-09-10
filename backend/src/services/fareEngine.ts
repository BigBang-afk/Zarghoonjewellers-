import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { ApiError } from "../utils/apiError.js"

export interface FareBreakdown {
  baseFare: number
  distanceCharge: number
  durationCharge: number
  subtotal: number
  demandMultiplier: number
  suggestedFare: number
  /** Typical marketplace range around the suggested fare — an estimate,
   * not a quote; the actual ride may settle anywhere the negotiation
   * guardrails allow (Phase 3 §3: "clearly label estimates"). */
  typicalRangeLow: number
  typicalRangeHigh: number
  minimumFare: number
  maximumFare: number | null
  commissionRate: number
  fareRuleId: string
  isEstimate: true
}

/**
 * Resolves the active FareRule for a city/vehicle-type, preferring a
 * zone-specific rule over the city-wide default (zoneId = null) — the
 * lookup order Admin → Pricing is expected to configure (docs/05 §F,
 * docs/06 §5). Never falls back to an in-code number: if no rule exists
 * for this city+vehicleType, fare estimation fails loudly rather than
 * silently hard-coding a price.
 */
export async function resolveFareRule(cityId: string, vehicleTypeId: string, zoneId?: string | null) {
  if (zoneId) {
    const zoneRule = await prisma.fareRule.findFirst({
      where: { cityId, vehicleTypeId, zoneId, isActive: true },
      orderBy: { effectiveFrom: "desc" },
    })
    if (zoneRule) return zoneRule
  }
  const cityRule = await prisma.fareRule.findFirst({
    where: { cityId, vehicleTypeId, zoneId: null, isActive: true },
    orderBy: { effectiveFrom: "desc" },
  })
  if (!cityRule) {
    throw ApiError.unprocessable(
      "NO_FARE_RULE",
      "This vehicle type is not yet priced in this city. An admin needs to configure a fare rule.",
    )
  }
  return cityRule
}

/** Live-ish demand signal: open requests per online driver, city-wide. */
async function getDemandMultiplier(cityId: string): Promise<number> {
  const [onlineDrivers, openRequests, min, max] = await Promise.all([
    prisma.driverProfile.count({ where: { cityId, availabilityStatus: "online" } }),
    prisma.rideRequest.count({ where: { cityId, status: { in: ["searching", "offers_open"] } } }),
    getSetting("fare.demandMultiplierMin"),
    getSetting("fare.demandMultiplierMax"),
  ])
  const ratio = openRequests / Math.max(1, onlineDrivers)
  const multiplier = min + (max - min) * Math.min(1, ratio)
  return Math.round(multiplier * 100) / 100
}

export async function computeFare(input: {
  cityId: string
  vehicleTypeId: string
  zoneId?: string | null
  distanceKm: number
  durationMin: number
}): Promise<FareBreakdown> {
  const rule = await resolveFareRule(input.cityId, input.vehicleTypeId, input.zoneId)
  const demandMultiplier = await getDemandMultiplier(input.cityId)

  const baseFare = rule.baseFare
  const distanceCharge = round2(input.distanceKm * rule.perKmRate)
  const durationCharge = round2(input.durationMin * rule.perMinRate)
  const subtotal = round2(baseFare + distanceCharge + durationCharge)

  const clampedMultiplier = Math.min(rule.surgeMaxMultiplier, Math.max(rule.surgeMinMultiplier, demandMultiplier))
  let suggestedFare = round2(subtotal * clampedMultiplier)
  suggestedFare = Math.max(rule.minimumFare, suggestedFare)
  if (rule.maximumFare != null) suggestedFare = Math.min(rule.maximumFare, suggestedFare)

  const rangeSpreadPct = await getSetting("fare.rangeSpreadPct")
  const clampRange = (v: number) => {
    let clamped = Math.max(rule.minimumFare, v)
    if (rule.maximumFare != null) clamped = Math.min(rule.maximumFare, clamped)
    return round2(clamped)
  }
  const typicalRangeLow = clampRange(suggestedFare * (1 - rangeSpreadPct))
  const typicalRangeHigh = clampRange(suggestedFare * (1 + rangeSpreadPct))

  return {
    baseFare,
    distanceCharge,
    durationCharge,
    subtotal,
    demandMultiplier: clampedMultiplier,
    suggestedFare,
    typicalRangeLow,
    typicalRangeHigh,
    minimumFare: rule.minimumFare,
    maximumFare: rule.maximumFare,
    commissionRate: rule.commissionRate,
    fareRuleId: rule.id,
    isEstimate: true,
  }
}

/** Validates a passenger/driver-proposed fare against the rule's guardrails. */
export function assertFareWithinGuardrails(fare: number, rule: { minimumFare: number; maximumFare: number | null }) {
  if (!Number.isFinite(fare) || fare <= 0) {
    throw ApiError.badRequest("INVALID_FARE", "Fare must be a positive number.")
  }
  if (fare < rule.minimumFare) {
    throw ApiError.badRequest("FARE_BELOW_MINIMUM", `Fare cannot be below the minimum of Rs ${rule.minimumFare}.`)
  }
  if (rule.maximumFare != null && fare > rule.maximumFare) {
    throw ApiError.badRequest("FARE_ABOVE_MAXIMUM", `Fare cannot exceed the maximum of Rs ${rule.maximumFare}.`)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
