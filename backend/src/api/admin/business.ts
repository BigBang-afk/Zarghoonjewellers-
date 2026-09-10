import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"

/**
 * Business / corporate accounts (Phase 2 §14) — architecture only, no
 * deep billing engine yet (invoicing, net-terms, etc. are Phase 4+).
 */
export const adminBusinessRouter = Router()

adminBusinessRouter.get(
  "/business-accounts",
  asyncHandler(async (_req, res) => {
    const accounts = await prisma.businessAccount.findMany({
      include: { billingContact: true, city: true, _count: { select: { employees: true, rides: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ accounts })
  }),
)

adminBusinessRouter.post(
  "/business-accounts",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(
    z.object({
      companyName: z.string().trim().min(2).max(100),
      billingContactUserId: z.string().uuid(),
      cityId: z.string().uuid(),
      paymentMethod: z.enum(["cash", "card", "wallet", "local_provider"]).default("wallet"),
      monthlySpendLimit: z.number().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const account = await prisma.businessAccount.create({
      data: { ...req.body, employees: { create: { userId: req.body.billingContactUserId, role: "owner" } } },
    })
    await writeAuditLog({ req, action: "business_account.create", targetTable: "business_accounts", targetId: account.id, after: req.body })
    res.status(201).json({ account })
  }),
)

adminBusinessRouter.post(
  "/business-accounts/:id/employees",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ userId: z.string().uuid(), role: z.enum(["owner", "member"]).default("member") })),
  asyncHandler(async (req, res) => {
    const account = await prisma.businessAccount.findUnique({ where: { id: req.params.id } })
    if (!account) throw ApiError.notFound("Business account not found.")
    const employee = await prisma.businessEmployee.upsert({
      where: { businessAccountId_userId: { businessAccountId: req.params.id, userId: req.body.userId } },
      create: { businessAccountId: req.params.id, userId: req.body.userId, role: req.body.role },
      update: { role: req.body.role },
    })
    await writeAuditLog({ req, action: "business_employee.add", targetTable: "business_employees", targetId: employee.id, after: req.body })
    res.status(201).json({ employee })
  }),
)
