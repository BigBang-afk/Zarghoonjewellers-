import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { parseRidePolicy, generateBusinessInvoice } from "../../services/businessService.js"

/**
 * Business / corporate accounts (Phase 2 §14, extended Phase 4 §13 and
 * Phase 5 §16 with departments, on-demand invoice generation, and fleet
 * accounts). Invoicing is a snapshot record an admin generates and marks
 * paid once payment is received offline — no payment-gateway auto-charge
 * for corporate net-terms exists here.
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

adminBusinessRouter.patch(
  "/business-accounts/:id",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(
    z.object({
      isActive: z.boolean().optional(),
      monthlySpendLimit: z.number().positive().nullable().optional(),
      ridePolicy: z
        .object({
          maxRideAmount: z.number().positive().optional(),
          allowedVehicleTypeIds: z.array(z.string().uuid()).optional(),
          allowedZoneIds: z.array(z.string().uuid()).optional(),
        })
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.businessAccount.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Business account not found.")

    const { ridePolicy, ...rest } = req.body as {
      isActive?: boolean
      monthlySpendLimit?: number | null
      ridePolicy?: unknown
    }
    const account = await prisma.businessAccount.update({
      where: { id: req.params.id },
      data: { ...rest, ...(ridePolicy !== undefined ? { ridePolicy: JSON.stringify(ridePolicy) } : {}) },
    })
    await writeAuditLog({
      req,
      action: "business_account.update",
      targetTable: "business_accounts",
      targetId: account.id,
      before: { isActive: existing.isActive, monthlySpendLimit: existing.monthlySpendLimit, ridePolicy: parseRidePolicy(existing.ridePolicy) },
      after: req.body,
    })
    res.json({ account: { ...account, ridePolicy: parseRidePolicy(account.ridePolicy) } })
  }),
)

adminBusinessRouter.post(
  "/business-accounts/:id/employees",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ userId: z.string().uuid(), role: z.enum(["owner", "admin", "member"]).default("member"), departmentId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const account = await prisma.businessAccount.findUnique({ where: { id: req.params.id } })
    if (!account) throw ApiError.notFound("Business account not found.")
    const employee = await prisma.businessEmployee.upsert({
      where: { businessAccountId_userId: { businessAccountId: req.params.id, userId: req.body.userId } },
      create: { businessAccountId: req.params.id, userId: req.body.userId, role: req.body.role, departmentId: req.body.departmentId },
      update: { role: req.body.role, departmentId: req.body.departmentId },
    })
    await writeAuditLog({ req, action: "business_employee.add", targetTable: "business_employees", targetId: employee.id, after: req.body })
    res.status(201).json({ employee })
  }),
)

// ---------------------------------------------------------------------
// Departments (Phase 5 §16)
// ---------------------------------------------------------------------

adminBusinessRouter.get(
  "/business-accounts/:id/departments",
  asyncHandler(async (req, res) => {
    const departments = await prisma.businessDepartment.findMany({
      where: { businessAccountId: req.params.id },
      include: { _count: { select: { employees: true } } },
      orderBy: { createdAt: "asc" },
    })
    res.json({ departments })
  }),
)

adminBusinessRouter.post(
  "/business-accounts/:id/departments",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ name: z.string().trim().min(2).max(80), monthlySpendLimit: z.number().positive().optional() })),
  asyncHandler(async (req, res) => {
    const account = await prisma.businessAccount.findUnique({ where: { id: req.params.id } })
    if (!account) throw ApiError.notFound("Business account not found.")
    const department = await prisma.businessDepartment.create({
      data: { businessAccountId: req.params.id, name: req.body.name, monthlySpendLimit: req.body.monthlySpendLimit },
    })
    await writeAuditLog({ req, action: "business_department.create", targetTable: "business_departments", targetId: department.id, after: req.body })
    res.status(201).json({ department })
  }),
)

adminBusinessRouter.patch(
  "/business-accounts/:id/departments/:departmentId",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ name: z.string().trim().min(2).max(80).optional(), monthlySpendLimit: z.number().positive().nullable().optional() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.businessDepartment.findUnique({ where: { id: req.params.departmentId } })
    if (!existing || existing.businessAccountId !== req.params.id) throw ApiError.notFound("Department not found.")
    const department = await prisma.businessDepartment.update({ where: { id: req.params.departmentId }, data: req.body })
    await writeAuditLog({ req, action: "business_department.update", targetTable: "business_departments", targetId: department.id, before: existing, after: req.body })
    res.json({ department })
  }),
)

adminBusinessRouter.delete(
  "/business-accounts/:id/departments/:departmentId",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.businessDepartment.findUnique({ where: { id: req.params.departmentId } })
    if (!existing || existing.businessAccountId !== req.params.id) throw ApiError.notFound("Department not found.")
    // Unassign rather than block deletion — an employee without a department just falls back to account-level policy only.
    await prisma.businessEmployee.updateMany({ where: { departmentId: req.params.departmentId }, data: { departmentId: null } })
    await prisma.businessDepartment.delete({ where: { id: req.params.departmentId } })
    await writeAuditLog({ req, action: "business_department.delete", targetTable: "business_departments", targetId: req.params.departmentId, before: existing })
    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------
// Invoices (Phase 5 §16)
// ---------------------------------------------------------------------

adminBusinessRouter.get(
  "/business-accounts/:id/invoices",
  asyncHandler(async (req, res) => {
    const invoices = await prisma.businessInvoice.findMany({ where: { businessAccountId: req.params.id }, orderBy: { periodStart: "desc" } })
    res.json({ invoices })
  }),
)

adminBusinessRouter.post(
  "/business-accounts/:id/invoices/generate",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date(), dueAt: z.coerce.date().optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.periodEnd <= req.body.periodStart) throw ApiError.badRequest("INVALID_PERIOD", "periodEnd must be after periodStart.")
    const invoice = await generateBusinessInvoice({
      businessAccountId: req.params.id,
      periodStart: req.body.periodStart,
      periodEnd: req.body.periodEnd,
      dueAt: req.body.dueAt,
    })
    await writeAuditLog({ req, action: "business_invoice.generate", targetTable: "business_invoices", targetId: invoice.id, after: req.body })
    res.status(201).json({ invoice })
  }),
)

adminBusinessRouter.post(
  "/business-invoices/:invoiceId/mark-paid",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.businessInvoice.findUnique({ where: { id: req.params.invoiceId } })
    if (!existing) throw ApiError.notFound("Invoice not found.")
    if (existing.status !== "issued") throw ApiError.conflict("INVOICE_NOT_ISSUED", `Cannot mark a "${existing.status}" invoice as paid.`)
    const invoice = await prisma.businessInvoice.update({ where: { id: req.params.invoiceId }, data: { status: "paid", paidAt: new Date() } })
    await writeAuditLog({ req, action: "business_invoice.mark_paid", targetTable: "business_invoices", targetId: invoice.id, before: existing })
    res.json({ invoice })
  }),
)

adminBusinessRouter.post(
  "/business-invoices/:invoiceId/void",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.businessInvoice.findUnique({ where: { id: req.params.invoiceId } })
    if (!existing) throw ApiError.notFound("Invoice not found.")
    if (existing.status === "paid") throw ApiError.conflict("INVOICE_ALREADY_PAID", "A paid invoice cannot be voided.")
    const invoice = await prisma.businessInvoice.update({ where: { id: req.params.invoiceId }, data: { status: "void" } })
    await writeAuditLog({ req, action: "business_invoice.void", targetTable: "business_invoices", targetId: invoice.id, before: existing })
    res.json({ invoice })
  }),
)

// ---------------------------------------------------------------------
// Fleet accounts (Phase 5 §16) — a company operating multiple drivers,
// distinct from BusinessAccount (whose employees ride as passengers).
// ---------------------------------------------------------------------

adminBusinessRouter.get(
  "/fleet-accounts",
  asyncHandler(async (_req, res) => {
    const fleets = await prisma.fleetAccount.findMany({
      include: { owner: { select: { fullName: true, phone: true } }, city: true, _count: { select: { drivers: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ fleets })
  }),
)

adminBusinessRouter.post(
  "/fleet-accounts",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(
    z.object({
      companyName: z.string().trim().min(2).max(100),
      ownerUserId: z.string().uuid(),
      cityId: z.string().uuid(),
      commissionSharePct: z.number().min(0).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const fleet = await prisma.fleetAccount.create({ data: req.body })
    await writeAuditLog({ req, action: "fleet_account.create", targetTable: "fleet_accounts", targetId: fleet.id, after: req.body })
    res.status(201).json({ fleet })
  }),
)

adminBusinessRouter.patch(
  "/fleet-accounts/:id",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(z.object({ isActive: z.boolean().optional(), commissionSharePct: z.number().min(0).max(100).nullable().optional() })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.fleetAccount.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Fleet account not found.")
    const fleet = await prisma.fleetAccount.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "fleet_account.update", targetTable: "fleet_accounts", targetId: fleet.id, before: existing, after: req.body })
    res.json({ fleet })
  }),
)

adminBusinessRouter.post(
  "/fleet-accounts/:id/drivers",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(z.object({ driverId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const fleet = await prisma.fleetAccount.findUnique({ where: { id: req.params.id } })
    if (!fleet) throw ApiError.notFound("Fleet account not found.")
    const driver = await prisma.driverProfile.update({ where: { id: req.body.driverId }, data: { fleetAccountId: req.params.id } })
    await writeAuditLog({ req, action: "fleet_account.assign_driver", targetTable: "driver_profiles", targetId: driver.id, after: { fleetAccountId: req.params.id } })
    res.json({ driver })
  }),
)

adminBusinessRouter.delete(
  "/fleet-accounts/:id/drivers/:driverId",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const driver = await prisma.driverProfile.findUnique({ where: { id: req.params.driverId } })
    if (!driver || driver.fleetAccountId !== req.params.id) throw ApiError.notFound("Driver not found on this fleet.")
    await prisma.driverProfile.update({ where: { id: req.params.driverId }, data: { fleetAccountId: null } })
    await writeAuditLog({ req, action: "fleet_account.unassign_driver", targetTable: "driver_profiles", targetId: driver.id })
    res.status(204).send()
  }),
)

adminBusinessRouter.get(
  "/fleet-accounts/:id/dashboard",
  asyncHandler(async (req, res) => {
    const fleet = await prisma.fleetAccount.findUnique({ where: { id: req.params.id } })
    if (!fleet) throw ApiError.notFound("Fleet account not found.")

    const drivers = await prisma.driverProfile.findMany({
      where: { fleetAccountId: req.params.id },
      include: { user: { select: { fullName: true, phone: true } } },
    })
    const driverIds = drivers.map((d) => d.id)

    const rides = driverIds.length
      ? await prisma.ride.findMany({ where: { driverId: { in: driverIds }, status: "ride_completed" }, select: { driverId: true, finalFare: true, agreedFare: true } })
      : []

    const earningsByDriver = new Map<string, number>()
    for (const r of rides) {
      earningsByDriver.set(r.driverId, (earningsByDriver.get(r.driverId) ?? 0) + (r.finalFare ?? r.agreedFare))
    }

    res.json({
      fleet,
      driverCount: drivers.length,
      totalCompletedRides: rides.length,
      totalGrossFareRs: Math.round(rides.reduce((sum, r) => sum + (r.finalFare ?? r.agreedFare), 0) * 100) / 100,
      drivers: drivers.map((d) => ({
        id: d.id,
        fullName: d.user.fullName,
        phone: d.user.phone,
        availabilityStatus: d.availabilityStatus,
        completedRides: d.completedRides,
        grossFareRs: Math.round((earningsByDriver.get(d.id) ?? 0) * 100) / 100,
      })),
    })
  }),
)
