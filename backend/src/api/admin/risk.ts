import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { recomputeRiskScore } from "../../services/riskService.js"

/**
 * Fraud/abuse manual review queue (Phase 3 §22) — every signal here only
 * ever *surfaces* a user for a human to look at. No account is ever
 * suspended, banned, or otherwise punished automatically off a single
 * signal (or any number of signals) — that decision is always a
 * separate, explicit admin action below.
 */
export const adminRiskRouter = Router()

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

adminRiskRouter.get(
  "/risk/queue",
  requireAdminRole("super_admin", "ops_manager", "safety_officer", "finance", "read_only"),
  asyncHandler(async (req, res) => {
    const { minScore = "1" } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = { score: { gte: Number(minScore) || 1 } }
    const [scores, total] = await Promise.all([
      prisma.riskScore.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true, role: true, status: true } } },
        orderBy: { score: "desc" },
        take,
        skip,
      }),
      prisma.riskScore.count({ where }),
    ])
    res.json({ queue: scores, total, page, pageSize: take })
  }),
)

adminRiskRouter.get(
  "/risk/users/:userId",
  requireAdminRole("super_admin", "ops_manager", "safety_officer", "finance", "read_only"),
  asyncHandler(async (req, res) => {
    const [score, events, user] = await Promise.all([
      prisma.riskScore.findUnique({ where: { userId: req.params.userId } }),
      prisma.riskEvent.findMany({ where: { userId: req.params.userId }, orderBy: { createdAt: "desc" } }),
      prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, fullName: true, phone: true, email: true, role: true, status: true } }),
    ])
    if (!user) throw ApiError.notFound("User not found.")
    res.json({ user, score: score?.score ?? 0, events })
  }),
)

adminRiskRouter.post(
  "/risk/events/:id/review",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(z.object({ note: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const event = await prisma.riskEvent.findUnique({ where: { id: req.params.id } })
    if (!event) throw ApiError.notFound("Risk event not found.")
    const updated = await prisma.riskEvent.update({ where: { id: event.id }, data: { reviewedAt: new Date() } })
    await recomputeRiskScore(event.userId)
    await writeAuditLog({ req, action: "risk_event.review", targetTable: "risk_events", targetId: event.id, after: req.body })
    res.json({ event: updated })
  }),
)

/**
 * The one place a human's review of the queue can actually act on a
 * user — deliberately separate from signal recording above, and always
 * attributable to a specific admin via the audit log.
 */
adminRiskRouter.patch(
  "/users/:id/status",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(z.object({ status: z.enum(["active", "suspended", "banned"]), reason: z.string().trim().min(1).max(300) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) throw ApiError.notFound("User not found.")
    const updated = await prisma.user.update({ where: { id: user.id }, data: { status: req.body.status } })
    await writeAuditLog({
      req,
      action: "user.status_change",
      targetTable: "users",
      targetId: user.id,
      before: { status: user.status },
      after: { status: req.body.status, reason: req.body.reason },
    })
    res.json({ user: updated })
  }),
)
