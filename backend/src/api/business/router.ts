import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"

/**
 * Business-facing endpoints (Phase 2 §14) — architecture only: employees
 * of a BusinessAccount can see their own account's rides and spending.
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
