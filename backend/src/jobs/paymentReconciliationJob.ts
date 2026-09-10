import { prisma } from "../utils/prisma.js"
import { getPaymentProvider } from "../services/payments/index.js"
import { recordFailure } from "../services/observability.js"
import { logger } from "../utils/logger.js"

/**
 * Payment reconciliation (Phase 4 §28) — a Payment can get stuck in
 * "pending"/"authorized" if a capture call or its webhook confirmation
 * never lands (a network blip, a provider outage). This asks the
 * provider directly for the real status rather than assuming, and only
 * writes when it actually differs from ours — safe to run repeatedly on
 * the same stuck row without side effects (idempotent).
 */
const STUCK_THRESHOLD_MS = 10 * 60 * 1000
const BATCH_SIZE = 50

export async function reconcileStuckPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS)
  const stuck = await prisma.payment.findMany({
    where: { status: { in: ["pending", "authorized"] }, createdAt: { lt: cutoff }, providerReference: { not: null } },
    take: BATCH_SIZE,
  })

  for (const payment of stuck) {
    if (!payment.providerReference) continue
    try {
      const provider = getPaymentProvider(payment.method)
      const result = await provider.checkStatus(payment.providerReference)
      if (result.status === "captured" && payment.status !== "captured") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "captured", capturedAt: new Date() } })
        logger.info("payment_reconciled", { paymentId: payment.id, from: payment.status, to: "captured" })
      } else if (result.status === "failed" && payment.status !== "failed") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } })
        logger.info("payment_reconciled", { paymentId: payment.id, from: payment.status, to: "failed" })
      }
    } catch (err) {
      recordFailure("payment_errors", { paymentId: payment.id, reason: "reconciliation_failed" })
      logger.warn("payment_reconciliation_failed", { paymentId: payment.id, message: err instanceof Error ? err.message : String(err) })
    }
  }
}
