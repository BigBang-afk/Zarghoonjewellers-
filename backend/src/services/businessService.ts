import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"

/**
 * Corporate accounts v1 (Phase 4 §13) — ride policy is stored as JSON on
 * BusinessAccount.ridePolicy (the field already existed from Phase 2's
 * architecture-only build); this module is the one place that parses and
 * enforces it, so the shape only needs to change in one spot.
 */
export interface RidePolicy {
  maxRideAmount?: number
  allowedVehicleTypeIds?: string[]
  allowedZoneIds?: string[]
}

export function parseRidePolicy(raw: string | null): RidePolicy {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as RidePolicy
  } catch {
    return {}
  }
}

/**
 * Enforced at ride-request time when a businessAccountId is supplied.
 * `fareRs` is the fare the request would actually be booked at (the
 * proposed fare for a competitive offer, the suggested fare otherwise) —
 * checked here rather than left to the driver/passenger to notice later.
 */
export async function enforceBusinessRidePolicy(params: {
  businessAccountId: string
  vehicleTypeId: string
  zoneId?: string | null
  fareRs: number
}): Promise<void> {
  const account = await prisma.businessAccount.findUnique({ where: { id: params.businessAccountId } })
  if (!account) throw ApiError.notFound("Business account not found.")
  if (!account.isActive) throw ApiError.forbidden("This business account is no longer active.")

  const policy = parseRidePolicy(account.ridePolicy)

  if (policy.allowedVehicleTypeIds?.length && !policy.allowedVehicleTypeIds.includes(params.vehicleTypeId)) {
    throw ApiError.badRequest("VEHICLE_TYPE_NOT_ALLOWED", "This vehicle type isn't allowed on your company's ride policy.")
  }
  if (policy.allowedZoneIds?.length && params.zoneId && !policy.allowedZoneIds.includes(params.zoneId)) {
    throw ApiError.badRequest("ZONE_NOT_ALLOWED", "This pickup area isn't allowed on your company's ride policy.")
  }
  if (policy.maxRideAmount != null && params.fareRs > policy.maxRideAmount) {
    throw ApiError.badRequest("RIDE_AMOUNT_EXCEEDS_POLICY", `Your company's ride policy caps a single ride at Rs ${policy.maxRideAmount}.`)
  }

  if (account.monthlySpendLimit != null) {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const spentAgg = await prisma.ride.aggregate({
      where: { businessAccountId: params.businessAccountId, status: "ride_completed", completedAt: { gte: startOfMonth } },
      _sum: { finalFare: true },
    })
    const spentSoFar = spentAgg._sum.finalFare ?? 0
    if (spentSoFar + params.fareRs > account.monthlySpendLimit) {
      throw ApiError.badRequest("MONTHLY_SPEND_LIMIT_REACHED", "Your company has reached its monthly ride spending limit.")
    }
  }
}
