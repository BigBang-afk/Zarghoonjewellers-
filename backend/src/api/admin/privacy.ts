import { Router } from "express"
import { randomUUID } from "node:crypto"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"

/**
 * Data privacy admin review (Phase 4 §26) — a human always reviews a
 * deletion request before anything happens; financial and ride records
 * are never touched, only the User row's own PII is anonymized so
 * accounting/audit history stays intact.
 */
export const adminPrivacyRouter = Router()

adminPrivacyRouter.get(
  "/privacy/deletion-requests",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { deletionRequestedAt: { not: null }, deletedAt: null },
      select: { id: true, fullName: true, phone: true, email: true, role: true, deletionRequestedAt: true, createdAt: true },
      orderBy: { deletionRequestedAt: "asc" },
    })
    res.json({ requests: users })
  }),
)

adminPrivacyRouter.post(
  "/privacy/deletion-requests/:userId/complete",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } })
    if (!user) throw ApiError.notFound("User not found.")
    if (!user.deletionRequestedAt) throw ApiError.badRequest("NO_DELETION_REQUEST", "This account has no pending deletion request.")
    if (user.deletedAt) throw ApiError.badRequest("ALREADY_DELETED", "This account has already been anonymized.")

    // Anonymize PII on the User row only — never touch Ride/Payment/
    // Transaction rows, which stay intact under this now-anonymous id
    // for accounting, dispute, and audit history.
    const placeholderPhone = `deleted-${randomUUID()}`
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: "Deleted User",
        phone: placeholderPhone,
        email: null,
        photoUrl: null,
        passwordHash: null,
        acquisitionSource: null,
        acquisitionCampaign: null,
        marketingOptIn: false,
        status: "suspended",
        deletedAt: new Date(),
      },
    })
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })

    await writeAuditLog({
      req,
      action: "user.deletion_completed",
      targetTable: "users",
      targetId: user.id,
      before: { fullName: user.fullName, phone: user.phone, email: user.email },
    })
    res.json({ userId: updated.id, deletedAt: updated.deletedAt })
  }),
)

adminPrivacyRouter.post(
  "/privacy/deletion-requests/:userId/dismiss",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } })
    if (!user) throw ApiError.notFound("User not found.")
    if (!user.deletionRequestedAt) throw ApiError.badRequest("NO_DELETION_REQUEST", "This account has no pending deletion request.")
    await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null } })
    await writeAuditLog({ req, action: "user.deletion_dismissed", targetTable: "users", targetId: user.id })
    res.status(204).send()
  }),
)
