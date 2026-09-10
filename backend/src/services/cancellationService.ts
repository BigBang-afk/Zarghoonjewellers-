import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { roundMoney, addMoney } from "../utils/money.js"
import { notify } from "./notifications/NotificationService.js"
import { recordRiskEvent } from "./riskService.js"
import {
  PassengerCancellationReason,
  DriverCancellationReason,
  EXEMPT_PASSENGER_CANCELLATION_REASONS,
  EXEMPT_DRIVER_CANCELLATION_REASONS,
} from "../types/enums.js"

/** Throws if `code` isn't a valid reason for this actor's role — a driver can never file a passenger-only code or vice versa. */
export function assertValidCancellationReason(role: "passenger" | "driver", code: string | null | undefined): void {
  if (code == null) return
  const valid = role === "passenger" ? (PassengerCancellationReason as readonly string[]) : (DriverCancellationReason as readonly string[])
  if (!valid.includes(code)) {
    throw ApiError.badRequest("INVALID_CANCELLATION_REASON", `"${code}" is not a valid cancellation reason for a ${role}.`)
  }
}

export interface CancellationPolicyResult {
  feeCharged: boolean
  feeAmount: number | null
  /** Machine-readable outcome — surfaced in tests/admin tooling, never shown verbatim to end users. */
  outcome:
    | "policy_disabled"
    | "within_free_window"
    | "exempt_reason"
    | "no_fee_configured"
    | "no_wallet"
    | "insufficient_balance"
    | "charged"
    | "driver_penalty_not_monetary"
}

/**
 * Phase 5 §14 — "no automatic penalties without configurable policy".
 * Nothing here charges a cent unless every gate passes:
 *   1. an admin has explicitly turned on cancellation.penaltyEnabled
 *      (default OFF platform-wide);
 *   2. the cancellation happened after the configured free window since
 *      booking;
 *   3. the stated reason isn't attributable to the *other* party (see
 *      EXEMPT_*_CANCELLATION_REASONS — e.g. a passenger cancelling
 *      because the driver wasn't moving is never charged, policy or not);
 *   4. (passenger only) the passenger's wallet actually holds the funds —
 *      this never creates a negative balance or an IOU; short funds means
 *      no fee, not a debt.
 *
 * A qualifying passenger fee is paid into the driver's wallet as real
 * compensation for the wasted trip to pickup, not just withheld.
 *
 * Driver-side lateness has no monetary mechanism yet — drivers are paid
 * out of ride fares, not pre-funded, so "charging" one would require a
 * payout-adjustment system this phase doesn't build. Rather than silently
 * doing nothing, it's recorded as an elevated-severity risk event so it's
 * still visible to admin review.
 */
export async function applyCancellationPolicy(params: {
  rideId: string
  actorRole: "passenger" | "driver"
  reasonCode: string | null
  bookedAt: Date
  passengerUserId: string
  driverUserId: string
}): Promise<CancellationPolicyResult> {
  const [penaltyEnabled, freeWindowSec, feeAmount] = await Promise.all([
    getSetting("cancellation.penaltyEnabled"),
    getSetting("cancellation.freeWindowSec"),
    getSetting("cancellation.passengerFeeAmount"),
  ])

  if (!penaltyEnabled) return { feeCharged: false, feeAmount: null, outcome: "policy_disabled" }

  const secondsSinceBooking = (Date.now() - params.bookedAt.getTime()) / 1000
  if (secondsSinceBooking < freeWindowSec) return { feeCharged: false, feeAmount: null, outcome: "within_free_window" }

  if (params.actorRole === "driver") {
    if (params.reasonCode && EXEMPT_DRIVER_CANCELLATION_REASONS.includes(params.reasonCode as DriverCancellationReason)) {
      return { feeCharged: false, feeAmount: null, outcome: "exempt_reason" }
    }
    await recordRiskEvent(params.driverUserId, "unusual_cancellation", "high", { rideId: params.rideId, lateCancellation: true, reasonCode: params.reasonCode })
    return { feeCharged: false, feeAmount: null, outcome: "driver_penalty_not_monetary" }
  }

  if (params.reasonCode && EXEMPT_PASSENGER_CANCELLATION_REASONS.includes(params.reasonCode as PassengerCancellationReason)) {
    return { feeCharged: false, feeAmount: null, outcome: "exempt_reason" }
  }
  if (feeAmount <= 0) return { feeCharged: false, feeAmount: null, outcome: "no_fee_configured" }

  const wallet = await prisma.wallet.findUnique({ where: { userId: params.passengerUserId } })
  if (!wallet) return { feeCharged: false, feeAmount: null, outcome: "no_wallet" }
  const rounded = roundMoney(feeAmount, wallet.currencyCode)

  const charged = await prisma.$transaction(async (tx) => {
    // Conditional decrement (Phase 4 §29 pattern, payoutService.ts) — never
    // lets a fee push the balance negative under concurrent requests.
    const claim = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: rounded } }, data: { balance: { decrement: rounded } } })
    if (claim.count === 0) return false

    const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "adjustment",
        amount: -rounded,
        balanceAfter: updatedWallet.balance,
        currencyCode: wallet.currencyCode,
        description: `Late cancellation fee — ride ${params.rideId.slice(0, 8)}`,
      },
    })

    const driverWallet = await tx.wallet.upsert({
      where: { userId: params.driverUserId },
      create: { userId: params.driverUserId, balance: 0, currencyCode: wallet.currencyCode },
      update: {},
    })
    const driverRounded = roundMoney(feeAmount, driverWallet.currencyCode)
    const driverNewBalance = addMoney(driverWallet.balance, driverRounded, driverWallet.currencyCode)
    await tx.wallet.update({ where: { id: driverWallet.id }, data: { balance: driverNewBalance } })
    await tx.transaction.create({
      data: {
        walletId: driverWallet.id,
        type: "adjustment",
        amount: driverRounded,
        balanceAfter: driverNewBalance,
        currencyCode: driverWallet.currencyCode,
        description: `Cancellation compensation — ride ${params.rideId.slice(0, 8)}`,
      },
    })

    return true
  })

  if (!charged) return { feeCharged: false, feeAmount: null, outcome: "insufficient_balance" }

  await notify({
    userId: params.passengerUserId,
    type: "payment",
    title: "Cancellation fee charged",
    body: `A late-cancellation fee of ${rounded} was deducted from your wallet.`,
    data: { rideId: params.rideId, amount: rounded },
  }).catch(() => {})

  return { feeCharged: true, feeAmount: rounded, outcome: "charged" }
}
