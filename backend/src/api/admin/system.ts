import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { hashPassword } from "../../utils/password.js"
import { ApiError } from "../../utils/apiError.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { writeAuditLog } from "../../shared/audit.js"
import { observabilitySnapshot } from "../../services/observability.js"
import { AdminRole } from "../../types/enums.js"

export const adminSystemRouter = Router()

/** Live request-latency percentiles and failure counters (Phase 4 §23). */
adminSystemRouter.get(
  "/observability",
  asyncHandler(async (_req, res) => {
    res.json(observabilitySnapshot())
  }),
)

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

adminSystemRouter.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const { targetTable, adminId } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = { ...(targetTable ? { targetTable } : {}), ...(adminId ? { adminId } : {}) }
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { admin: { include: { user: true } } }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.auditLog.count({ where }),
    ])
    res.json({ logs, total, page, pageSize: take })
  }),
)

// Admin user management is a super_admin-only capability (docs/09 §4 admin:super scope).
adminSystemRouter.get(
  "/admin-users",
  requireAdminRole("super_admin"),
  asyncHandler(async (_req, res) => {
    const admins = await prisma.adminUser.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } })
    res.json({ admins })
  }),
)

adminSystemRouter.post(
  "/admin-users",
  requireAdminRole("super_admin"),
  validateBody(
    z.object({
      fullName: z.string().trim().min(2).max(80),
      phone: z.string().trim().min(7).max(15),
      email: z.string().trim().email(),
      password: z.string().min(8).max(72),
      role: z.enum(AdminRole),
      cityScope: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findUnique({ where: { phone: req.body.phone } })
    if (existing) throw ApiError.conflict("PHONE_ALREADY_REGISTERED", "An account with this phone already exists.")

    const passwordHash = await hashPassword(req.body.password)
    const user = await prisma.user.create({
      data: {
        fullName: req.body.fullName,
        phone: req.body.phone,
        email: req.body.email,
        passwordHash,
        role: "admin",
        status: "active",
        phoneVerifiedAt: new Date(),
        adminProfile: { create: { role: req.body.role, cityScope: req.body.cityScope } },
      },
      include: { adminProfile: true },
    })

    await writeAuditLog({ req, action: "admin_user.create", targetTable: "admin_users", targetId: user.adminProfile!.id, after: { role: req.body.role } })
    res.status(201).json({ user })
  }),
)
