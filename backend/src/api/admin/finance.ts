import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { getPaymentProvider } from "../../services/payments/index.js"
import { markPayoutProcessing, completePayout, failPayout } from "../../services/payoutService.js"
import { writeAuditLog } from "../../shared/audit.js"

export const adminFinanceRouter = Router()

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

adminFinanceRouter.get(
  "/payments",
  requireAdminRole("super_admin", "finance", "ops_manager"),
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = status ? { status } : {}
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { ride: { include: { passenger: { include: { user: true } }, driver: { include: { user: true } } } }, commission: true },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.payment.count({ where }),
    ])
    res.json({ payments, total, page, pageSize: take })
  }),
)

adminFinanceRouter.get(
  "/commissions",
  requireAdminRole("super_admin", "finance", "ops_manager"),
  asyncHandler(async (req, res) => {
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const [commissions, total, sumAgg] = await Promise.all([
      prisma.commission.findMany({
        include: { payment: { include: { ride: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.commission.count(),
      prisma.commission.aggregate({ _sum: { amount: true } }),
    ])
    res.json({ commissions, total, page, pageSize: take, totalCommissionRs: sumAgg._sum.amount ?? 0 })
  }),
)

// ---------------------------------------------------------------------
// Driver payouts (Phase 4 §5) — admin can review activity and record a
// processing/completed/failed outcome, but only ever COMPLETED once the
// admin is attesting to (or the payment-provider webhook confirms) an
// actual transfer — never claimed automatically.
// ---------------------------------------------------------------------

adminFinanceRouter.get(
  "/payouts",
  requireAdminRole("super_admin", "finance", "ops_manager"),
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = status ? { status } : {}
    const [payouts, total] = await Promise.all([
      prisma.payoutRequest.findMany({
        where,
        include: { driver: { include: { user: { select: { fullName: true, phone: true } } } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.payoutRequest.count({ where }),
    ])
    res.json({ payouts, total, page, pageSize: take })
  }),
)

adminFinanceRouter.post(
  "/payouts/:id/processing",
  requireAdminRole("super_admin", "finance"),
  asyncHandler(async (req, res) => {
    const payout = await markPayoutProcessing(req.params.id)
    await writeAuditLog({ req, action: "payout.processing", targetTable: "payout_requests", targetId: payout.id })
    res.json({ payout })
  }),
)

adminFinanceRouter.post(
  "/payouts/:id/complete",
  requireAdminRole("super_admin", "finance"),
  validateBody(z.object({ reference: z.string().trim().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const payout = await completePayout(req.params.id, req.body.reference)
    await writeAuditLog({ req, action: "payout.complete", targetTable: "payout_requests", targetId: payout.id, after: req.body })
    res.json({ payout })
  }),
)

adminFinanceRouter.post(
  "/payouts/:id/fail",
  requireAdminRole("super_admin", "finance"),
  validateBody(z.object({ notes: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const payout = await failPayout(req.params.id, req.body.notes)
    await writeAuditLog({ req, action: "payout.fail", targetTable: "payout_requests", targetId: payout.id, after: req.body })
    res.json({ payout })
  }),
)

/** Reconciliation visibility (Phase 4 §4/§28) — every inbound webhook, whatever happened to it. */
adminFinanceRouter.get(
  "/webhooks",
  requireAdminRole("super_admin", "finance", "ops_manager"),
  asyncHandler(async (req, res) => {
    const { status, provider } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = { ...(status ? { status } : {}), ...(provider ? { provider } : {}) }
    const [events, total] = await Promise.all([
      prisma.webhookEvent.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.webhookEvent.count({ where }),
    ])
    res.json({ events, total, page, pageSize: take })
  }),
)

/** Ask the provider directly for a transaction's current state — for support/reconciliation, not the app's own record. */
adminFinanceRouter.get(
  "/payments/:providerReference/provider-status",
  requireAdminRole("super_admin", "finance", "ops_manager"),
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findFirst({ where: { providerReference: req.params.providerReference } })
    if (!payment) throw ApiError.notFound("No payment found with that provider reference.")
    const provider = getPaymentProvider(payment.method)
    const [status, transaction] = await Promise.all([
      provider.checkStatus(req.params.providerReference),
      provider.transactionLookup(req.params.providerReference),
    ])
    res.json({ localStatus: payment.status, providerStatus: status, providerTransaction: transaction })
  }),
)
