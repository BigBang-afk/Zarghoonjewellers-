import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { roundMoney } from "../utils/money.js"
import { notify } from "./notifications/NotificationService.js"

/**
 * Driver payout system (Phase 4 §5). Wallet has three numbers:
 *   balance        — available/withdrawable right now
 *   pendingBalance — held while a payout request is in flight
 *   paidBalance    — lifetime total actually paid out (never decremented)
 *
 * A payout only ever reaches COMPLETED once something outside this
 * process confirms the transfer — a payment-provider webhook (see
 * api/public/webhooks.ts) or an explicit admin action recording a manual
 * transfer they performed. Never inferred, never assumed.
 */

const OPEN_STATUSES = ["requested", "processing"] as const

export async function requestPayout(driverUserId: string, driverId: string, amount: number, method: string) {
  if (amount <= 0) throw ApiError.badRequest("INVALID_AMOUNT", "Payout amount must be positive.")

  const wallet = await prisma.wallet.findUnique({ where: { userId: driverUserId } })
  if (!wallet || wallet.balance < amount) {
    throw ApiError.badRequest("INSUFFICIENT_BALANCE", "Your available balance is lower than the requested payout amount.")
  }

  const rounded = roundMoney(amount, wallet.currencyCode)
  const [, payout] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: roundMoney(wallet.balance - rounded, wallet.currencyCode), pendingBalance: roundMoney(wallet.pendingBalance + rounded, wallet.currencyCode) },
    }),
    prisma.payoutRequest.create({ data: { driverId, amount: rounded, method, status: "requested" } }),
  ])

  return payout
}

export async function cancelPayout(payoutId: string, driverId: string) {
  const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId }, include: { driver: true } })
  if (!payout) throw ApiError.notFound("Payout request not found.")
  if (payout.driverId !== driverId) throw ApiError.forbidden()
  if (payout.status !== "requested") throw ApiError.conflict("PAYOUT_NOT_CANCELLABLE", "Only a payout that hasn't started processing yet can be cancelled.")

  return returnFundsAndClose(payout, "cancelled")
}

/** Admin marks a payout as actively being sent (e.g. a bank transfer has been initiated) — no balance change, just visibility. */
export async function markPayoutProcessing(payoutId: string) {
  const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } })
  if (!payout) throw ApiError.notFound("Payout request not found.")
  if (payout.status !== "requested") throw ApiError.conflict("INVALID_TRANSITION", `Cannot move a payout from "${payout.status}" to "processing".`)
  return prisma.payoutRequest.update({ where: { id: payoutId }, data: { status: "processing" } })
}

/**
 * Marks a payout COMPLETED — called from the payment-provider webhook on
 * an automated confirmation, or from an admin endpoint recording a
 * manual transfer they themselves performed and are attesting to. Either
 * way, moves the held amount from pending to the lifetime-paid total.
 */
export async function completePayout(payoutId: string, reference?: string) {
  const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId }, include: { driver: true } })
  if (!payout) throw ApiError.notFound("Payout request not found.")
  if (!(OPEN_STATUSES as readonly string[]).includes(payout.status)) return payout // already terminal — idempotent no-op

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: payout.driver.userId } })
  const [, updated] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: Math.max(0, roundMoney(wallet.pendingBalance - payout.amount, wallet.currencyCode)),
        paidBalance: roundMoney(wallet.paidBalance + payout.amount, wallet.currencyCode),
      },
    }),
    prisma.payoutRequest.update({ where: { id: payoutId }, data: { status: "completed", processedAt: new Date(), reference: reference ?? payout.reference } }),
  ])
  await notify({ userId: payout.driver.userId, type: "payment", title: "Payout completed", body: `Rs ${payout.amount} was sent to your ${payout.method} account.`, data: { payoutId } })
  return updated
}

export async function failPayout(payoutId: string, notes?: string) {
  const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId }, include: { driver: true } })
  if (!payout) throw ApiError.notFound("Payout request not found.")
  if (!(OPEN_STATUSES as readonly string[]).includes(payout.status)) return payout

  const updated = await returnFundsAndClose(payout, "failed", notes)
  await notify({ userId: payout.driver.userId, type: "payment", title: "Payout failed", body: `Rs ${payout.amount} could not be sent — it's back in your available balance. ${notes ?? ""}`, data: { payoutId } })
  return updated
}

async function returnFundsAndClose(
  payout: { id: string; amount: number; driverId: string; driver: { userId: string } },
  status: "cancelled" | "failed",
  notes?: string,
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: payout.driver.userId } })
  const [, updated] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: Math.max(0, roundMoney(wallet.pendingBalance - payout.amount, wallet.currencyCode)),
        balance: roundMoney(wallet.balance + payout.amount, wallet.currencyCode),
      },
    }),
    prisma.payoutRequest.update({ where: { id: payout.id }, data: { status, processedAt: new Date(), notes } }),
  ])
  return updated
}
