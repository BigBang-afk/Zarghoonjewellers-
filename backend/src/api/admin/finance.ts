import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ApiError } from "../../utils/apiError.js"
import { getPaymentProvider } from "../../services/payments/index.js"

export const adminFinanceRouter = Router()

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

adminFinanceRouter.get(
  "/payments",
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

/** Reconciliation visibility (Phase 4 §4/§28) — every inbound webhook, whatever happened to it. */
adminFinanceRouter.get(
  "/webhooks",
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
