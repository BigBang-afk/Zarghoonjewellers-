import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireAuth } from "../../middleware/auth.js"
import { validateBody } from "../../middleware/validate.js"
import { ApiError } from "../../utils/apiError.js"
import { parseRidePolicy } from "../../services/businessService.js"

/**
 * Business-facing endpoints (Phase 2 §14, extended Phase 4 §13) — employees
 * of a BusinessAccount can see their own account's rides and spending, and
 * OWNER/ADMIN members can manage the ride policy and roster themselves
 * without needing platform-admin involvement.
 * No invoicing/net-terms/billing engine here (explicitly deferred).
 */
export const businessRouter = Router()
businessRouter.use(requireAuth)

async function requireMembership(businessAccountId: string, userId: string) {
  const membership = await prisma.businessEmployee.findUnique({
    where: { businessAccountId_userId: { businessAccountId, userId } },
  })
  if (!membership) throw ApiError.forbidden("You are not a member of this business account.")
  return membership
}

async function requireManager(businessAccountId: string, userId: string) {
  const membership = await requireMembership(businessAccountId, userId)
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw ApiError.forbidden("Only account owners or admins can do this.")
  }
  return membership
}

const ridePolicySchema = z.object({
  maxRideAmount: z.number().positive().optional(),
  allowedVehicleTypeIds: z.array(z.string().uuid()).optional(),
  allowedZoneIds: z.array(z.string().uuid()).optional(),
})

businessRouter.get(
  "/accounts",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.businessEmployee.findMany({
      where: { userId: req.auth!.userId },
      include: { businessAccount: { include: { city: true } } },
    })
    res.json({ accounts: memberships.map((m) => ({ role: m.role, ...m.businessAccount })) })
  }),
)

businessRouter.get(
  "/accounts/:id/dashboard",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.auth!.userId)

    const rides = await prisma.ride.findMany({
      where: { businessAccountId: req.params.id },
      include: { passenger: { include: { user: true } }, driver: { include: { user: true } }, pickup: true, destination: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    const completed = rides.filter((r) => r.status === "ride_completed")
    const totalSpendingRs = completed.reduce((sum, r) => sum + (r.finalFare ?? r.agreedFare), 0)

    const byEmployee = new Map<string, { userId: string; name: string; rideCount: number; spendingRs: number }>()
    for (const r of completed) {
      const userId = r.passenger.userId
      const entry = byEmployee.get(userId) ?? { userId, name: r.passenger.user.fullName, rideCount: 0, spendingRs: 0 }
      entry.rideCount += 1
      entry.spendingRs += r.finalFare ?? r.agreedFare
      byEmployee.set(userId, entry)
    }

    res.json({
      totalRides: rides.length,
      completedRides: completed.length,
      totalSpendingRs: Math.round(totalSpendingRs * 100) / 100,
      employeeBreakdown: Array.from(byEmployee.values()),
      rides: rides.map((r) => ({
        id: r.id,
        status: r.status,
        fare: r.finalFare ?? r.agreedFare,
        employee: r.passenger.user.fullName,
        driver: r.driver.user.fullName,
        pickup: r.pickup.address,
        destination: r.destination.address,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    })
  }),
)

businessRouter.get(
  "/accounts/:id/employees",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.auth!.userId)
    const employees = await prisma.businessEmployee.findMany({
      where: { businessAccountId: req.params.id },
      include: { user: { select: { fullName: true, phone: true, email: true } } },
      orderBy: { createdAt: "asc" },
    })
    res.json({ employees })
  }),
)

businessRouter.get(
  "/accounts/:id/policy",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.auth!.userId)
    const account = await prisma.businessAccount.findUnique({ where: { id: req.params.id } })
    if (!account) throw ApiError.notFound("Business account not found.")
    res.json({ policy: parseRidePolicy(account.ridePolicy), monthlySpendLimit: account.monthlySpendLimit })
  }),
)

businessRouter.put(
  "/accounts/:id/policy",
  validateBody(ridePolicySchema),
  asyncHandler(async (req, res) => {
    await requireManager(req.params.id, req.auth!.userId)
    const account = await prisma.businessAccount.update({
      where: { id: req.params.id },
      data: { ridePolicy: JSON.stringify(req.body) },
    })
    res.json({ policy: parseRidePolicy(account.ridePolicy) })
  }),
)

businessRouter.post(
  "/accounts/:id/employees",
  validateBody(z.object({ userId: z.string().uuid(), role: z.enum(["admin", "member"]).default("member") })),
  asyncHandler(async (req, res) => {
    const manager = await requireManager(req.params.id, req.auth!.userId)
    if (req.body.role === "admin" && manager.role !== "owner") {
      throw ApiError.forbidden("Only the account owner can assign the admin role.")
    }
    const employee = await prisma.businessEmployee.upsert({
      where: { businessAccountId_userId: { businessAccountId: req.params.id, userId: req.body.userId } },
      create: { businessAccountId: req.params.id, userId: req.body.userId, role: req.body.role },
      update: { role: req.body.role },
    })
    res.status(201).json({ employee })
  }),
)

businessRouter.delete(
  "/accounts/:id/employees/:userId",
  asyncHandler(async (req, res) => {
    const manager = await requireManager(req.params.id, req.auth!.userId)
    const target = await prisma.businessEmployee.findUnique({
      where: { businessAccountId_userId: { businessAccountId: req.params.id, userId: req.params.userId } },
    })
    if (!target) throw ApiError.notFound("Employee not found on this account.")
    if (target.role === "owner") throw ApiError.badRequest("CANNOT_REMOVE_OWNER", "The account owner cannot be removed.")
    if (target.role === "admin" && manager.role !== "owner") {
      throw ApiError.forbidden("Only the account owner can remove an admin.")
    }
    await prisma.businessEmployee.delete({ where: { id: target.id } })
    res.status(204).send()
  }),
)
