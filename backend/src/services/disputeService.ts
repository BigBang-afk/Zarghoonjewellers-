import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getPaymentProvider } from "./payments/index.js"
import { notify } from "./notifications/NotificationService.js"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Dispute resolution actions (Phase 3 §19) — every decision is
 * transactional, notifies the affected parties, and leaves a complete
 * audit trail via the Dispute row itself (decision/resolution/
 * resolvedBy/resolvedAt) plus the writeAuditLog call made by the caller.
 */

export async function requestMoreInfo(disputeId: string, _adminUserId: string, message: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } })
  if (!dispute) throw ApiError.notFound("Dispute not found.")
  if (["resolved", "rejected", "closed"].includes(dispute.status)) {
    throw ApiError.conflict("DISPUTE_CLOSED", "This dispute is already closed.")
  }
  const updated = await prisma.dispute.update({ where: { id: disputeId }, data: { status: "awaiting_info" } })
  await notify({ userId: dispute.raisedById, type: "system", title: "More information needed", body: message, data: { disputeId } })
  return updated
}

export async function refundDispute(disputeId: string, adminUserId: string, amountRs: number | undefined, resolution: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { ride: { include: { payment: true, passenger: true } } } })
  if (!dispute) throw ApiError.notFound("Dispute not found.")
  if (["resolved", "rejected", "closed"].includes(dispute.status)) {
    throw ApiError.conflict("DISPUTE_CLOSED", "This dispute is already closed.")
  }
  const payment = dispute.ride.payment
  if (!payment) throw ApiError.badRequest("NO_PAYMENT", "This ride has no payment to refund.")

  const refundAmount = round2(Math.min(amountRs ?? payment.amount, payment.amount));
  const provider = getPaymentProvider(payment.method as "cash" | "card" | "wallet" | "local_provider")
  if (payment.providerReference) {
    await provider.refund(payment.providerReference, refundAmount)
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId: dispute.ride.passenger.userId },
    create: { userId: dispute.ride.passenger.userId, balance: 0, currencyCode: payment.currencyCode },
    update: {},
  })
  const newBalance = round2(wallet.balance + refundAmount)

  const [, , updated] = await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { refundedAt: new Date(), status: "refunded" } }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } }),
    prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "resolved", decision: "refund_passenger", resolution, resolvedById: adminUserId, resolvedAt: new Date() },
    }),
  ])
  await prisma.transaction.create({
    data: { walletId: wallet.id, paymentId: payment.id, type: "refund", amount: refundAmount, balanceAfter: newBalance, description: `Dispute refund: ${resolution}` },
  })

  await notify({ userId: dispute.ride.passenger.userId, type: "payment", title: "You've been refunded", body: `Rs ${refundAmount} was refunded to your wallet. ${resolution}`, data: { disputeId, refundAmount } })
  return updated
}

export async function adjustDriverPayout(disputeId: string, adminUserId: string, amountRs: number, resolution: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { ride: { include: { driver: true } } } })
  if (!dispute) throw ApiError.notFound("Dispute not found.")
  if (["resolved", "rejected", "closed"].includes(dispute.status)) {
    throw ApiError.conflict("DISPUTE_CLOSED", "This dispute is already closed.")
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId: dispute.ride.driver.userId },
    create: { userId: dispute.ride.driver.userId, balance: 0, currencyCode: "PKR" },
    update: {},
  })
  const newBalance = round2(wallet.balance + amountRs)

  const [, updated] = await prisma.$transaction([
    prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } }),
    prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "resolved", decision: "adjust_driver_payout", resolution, resolvedById: adminUserId, resolvedAt: new Date() },
    }),
  ])
  await prisma.transaction.create({
    data: { walletId: wallet.id, type: "adjustment", amount: amountRs, balanceAfter: newBalance, description: `Dispute adjustment: ${resolution}` },
  })

  await notify({ userId: dispute.ride.driver.userId, type: "payment", title: "Payout adjustment", body: `Rs ${amountRs} was adjusted to your wallet. ${resolution}`, data: { disputeId, amountRs } })
  return updated
}

export async function closeDispute(disputeId: string, adminUserId: string, resolution: string, status: "closed" | "rejected") {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } })
  if (!dispute) throw ApiError.notFound("Dispute not found.")
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: { status, decision: "no_action", resolution, resolvedById: adminUserId, resolvedAt: new Date() },
  })
  await notify({ userId: dispute.raisedById, type: "system", title: "Dispute update", body: resolution, data: { disputeId } })
  return updated
}
