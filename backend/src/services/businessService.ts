import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { addMoney, roundMoney } from "../utils/money.js"

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

function startOfCurrentMonth(): Date {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Enforced at ride-request time when a businessAccountId is supplied.
 * `fareRs` is the fare the request would actually be booked at (the
 * proposed fare for a competitive offer, the suggested fare otherwise) —
 * checked here rather than left to the driver/passenger to notice later.
 *
 * Phase 5 §16 — also resolves the requesting employee's current
 * department (if any) and, when that department has its own spend limit,
 * enforces it *in addition to* the account-wide limit — a department can
 * only ever be more restrictive, never loosen the account's own cap.
 * Returns the resolved departmentId so the caller can snapshot it onto
 * the RideRequest without a second lookup.
 */
export async function enforceBusinessRidePolicy(params: {
  businessAccountId: string
  employeeUserId: string
  vehicleTypeId: string
  zoneId?: string | null
  fareRs: number
}): Promise<{ departmentId: string | null }> {
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
    const spentAgg = await prisma.ride.aggregate({
      where: { businessAccountId: params.businessAccountId, status: "ride_completed", completedAt: { gte: startOfCurrentMonth() } },
      _sum: { finalFare: true },
    })
    const spentSoFar = spentAgg._sum.finalFare ?? 0
    if (spentSoFar + params.fareRs > account.monthlySpendLimit) {
      throw ApiError.badRequest("MONTHLY_SPEND_LIMIT_REACHED", "Your company has reached its monthly ride spending limit.")
    }
  }

  const employee = await prisma.businessEmployee.findUnique({
    where: { businessAccountId_userId: { businessAccountId: params.businessAccountId, userId: params.employeeUserId } },
  })
  const departmentId = employee?.departmentId ?? null

  if (departmentId) {
    const department = await prisma.businessDepartment.findUnique({ where: { id: departmentId } })
    if (department?.monthlySpendLimit != null) {
      const deptSpentAgg = await prisma.ride.aggregate({
        where: { rideRequest: { departmentId }, status: "ride_completed", completedAt: { gte: startOfCurrentMonth() } },
        _sum: { finalFare: true },
      })
      const deptSpentSoFar = deptSpentAgg._sum.finalFare ?? 0
      if (deptSpentSoFar + params.fareRs > department.monthlySpendLimit) {
        throw ApiError.badRequest("DEPARTMENT_SPEND_LIMIT_REACHED", `Your department has reached its monthly ride spending limit.`)
      }
    }
  }

  return { departmentId }
}

/**
 * Phase 5 §16 — invoice generation. A snapshot, not a live view: totals
 * are frozen at generation time so a later refund/dispute adjustment
 * doesn't silently rewrite an invoice that's already been sent. Admin
 * triggers this on demand (no automatic recurring billing — see the
 * BusinessInvoice model comment for why).
 */
export async function generateBusinessInvoice(params: { businessAccountId: string; periodStart: Date; periodEnd: Date; dueAt?: Date }) {
  const account = await prisma.businessAccount.findUnique({ where: { id: params.businessAccountId }, include: { city: true } })
  if (!account) throw ApiError.notFound("Business account not found.")

  const rides = await prisma.ride.findMany({
    where: {
      businessAccountId: params.businessAccountId,
      status: "ride_completed",
      completedAt: { gte: params.periodStart, lt: params.periodEnd },
    },
    select: { finalFare: true, agreedFare: true },
  })

  const currencyCode = account.city.currencyCode
  const totalAmount = rides.reduce((sum, r) => addMoney(sum, r.finalFare ?? r.agreedFare, currencyCode), 0)

  return prisma.businessInvoice.create({
    data: {
      businessAccountId: params.businessAccountId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      rideCount: rides.length,
      totalAmount: roundMoney(totalAmount, currencyCode),
      currencyCode,
      dueAt: params.dueAt,
    },
  })
}
