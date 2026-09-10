import { Router, type Request } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { ApiError } from "../../utils/apiError.js"
import { getPaymentProvider } from "../../services/payments/index.js"
import { completePayout, failPayout } from "../../services/payoutService.js"
import { emitToAdmin } from "../../realtime/socket.js"

/**
 * Payment provider webhooks (Phase 4 §4) — unauthenticated (a payment
 * provider can't send our JWT) but every event is:
 *   1. Signature-verified against the real raw request bytes when the
 *      provider adapter supports it (cash has no webhooks; the card mock
 *      does, as a template for a real Stripe/JazzCash adapter).
 *   2. Recorded once per (provider, eventId) via a DB unique constraint
 *      — a redelivered event (every provider redelivers on a timeout)
 *      is a no-op the second time, never double-processed.
 */
export const webhooksRouter = Router()

const webhookBodySchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  eventType: z.enum(["payment.captured", "payment.failed", "refund.completed", "payout.completed", "payout.failed"]),
  providerReference: z.string().trim().min(1).max(200),
  amountRs: z.number().optional(),
})

webhooksRouter.post(
  "/:provider",
  validateBody(webhookBodySchema),
  asyncHandler(async (req, res) => {
    const providerName = req.params.provider
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? JSON.stringify(req.body)

    let provider
    try {
      provider = getPaymentProvider(providerName)
    } catch {
      // An unknown provider name is never the caller's fault to retry
      // forever over — acknowledge so it stops retrying, but record it.
      await prisma.webhookEvent.create({
        data: { provider: providerName, eventId: req.body.eventId, eventType: req.body.eventType, payload: rawBody, status: "failed", error: "Unknown provider" },
      }).catch(() => {})
      return res.status(200).json({ ok: true, ignored: true })
    }

    if (provider.verifyWebhookSignature) {
      const signature = req.header("X-RIVO-Webhook-Signature")
      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        throw ApiError.unauthorized("Invalid webhook signature.")
      }
    }

    let event
    try {
      event = await prisma.webhookEvent.create({
        data: { provider: providerName, eventId: req.body.eventId, eventType: req.body.eventType, payload: rawBody, status: "received" },
      })
    } catch {
      // Unique (provider, eventId) violation — we've already processed
      // this exact event. Idempotent: acknowledge, do nothing else.
      return res.status(200).json({ ok: true, duplicate: true })
    }

    try {
      await processWebhookEvent(req.body)
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: "processed", processedAt: new Date() } })
    } catch (err) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: "failed", error: err instanceof Error ? err.message : String(err) } })
      emitToAdmin("webhook.processing_failed", { provider: providerName, eventId: req.body.eventId, eventType: req.body.eventType })
      // Still 200 — the event is durably recorded for manual reconciliation;
      // a 5xx here would just cause the provider to hammer us with retries
      // for a failure that a retry can't fix (e.g. a payout row that no
      // longer exists).
    }

    res.status(200).json({ ok: true })
  }),
)

async function processWebhookEvent(body: z.infer<typeof webhookBodySchema>): Promise<void> {
  switch (body.eventType) {
    case "payment.captured": {
      const payment = await prisma.payment.findFirst({ where: { providerReference: body.providerReference } })
      if (payment && payment.status !== "captured") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "captured", capturedAt: new Date() } })
      }
      return
    }
    case "payment.failed": {
      const payment = await prisma.payment.findFirst({ where: { providerReference: body.providerReference } })
      if (payment && payment.status !== "captured") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } })
      }
      return
    }
    case "refund.completed": {
      const payment = await prisma.payment.findFirst({ where: { providerReference: body.providerReference } })
      if (payment && !payment.refundedAt) {
        await prisma.payment.update({ where: { id: payment.id }, data: { refundedAt: new Date(), status: "refunded" } })
      }
      return
    }
    case "payout.completed": {
      // Only ever mark a payout COMPLETED here, from the provider's own
      // confirmation — never claim the transfer happened any earlier
      // (Phase 4 §5).
      const payout = await prisma.payoutRequest.findFirst({ where: { reference: body.providerReference, status: { in: ["requested", "processing"] } } })
      if (payout) await completePayout(payout.id, body.providerReference)
      return
    }
    case "payout.failed": {
      const payout = await prisma.payoutRequest.findFirst({ where: { reference: body.providerReference, status: { in: ["requested", "processing"] } } })
      if (payout) await failPayout(payout.id, "Payment provider reported failure.")
      return
    }
  }
}
