import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { RIDE_STATUS_TRANSITIONS, type RideStatus } from "../types/enums.js"
import { resolveFareRule } from "./fareEngine.js"
import { getPaymentProvider } from "./payments/index.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToRide, emitToUser, emitToAdmin } from "../realtime/socket.js"

async function loadRideWithParties(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      passenger: { include: { user: true } },
      driver: { include: { user: true } },
      rideRequest: true,
    },
  })
  if (!ride) throw ApiError.notFound("Ride not found.")
  return ride
}

/** Passenger cancels a ride request before it's matched to a driver. */
export async function cancelRideRequest(rideRequestId: string, passengerProfileId: string) {
  const request = await prisma.rideRequest.findUnique({ where: { id: rideRequestId } })
  if (!request) throw ApiError.notFound("Ride request not found.")
  if (request.passengerId !== passengerProfileId) throw ApiError.forbidden()
  if (!["searching", "offers_open"].includes(request.status)) {
    throw ApiError.conflict("REQUEST_NOT_CANCELLABLE", "This request can no longer be cancelled — it may already be matched.")
  }

  await prisma.$transaction([
    prisma.rideRequest.update({ where: { id: rideRequestId }, data: { status: "cancelled" } }),
    prisma.rideOffer.updateMany({ where: { rideRequestId, status: "pending" }, data: { status: "withdrawn" } }),
  ])

  const offers = await prisma.rideOffer.findMany({ where: { rideRequestId }, include: { driver: { include: { user: true } } } })
  for (const offer of offers) {
    emitToUser(offer.driver.user.id, "ride_request.cancelled", { rideRequestId })
  }

  return { ok: true }
}

function assertActorAllowed(role: "passenger" | "driver", target: RideStatus) {
  const driverOnly: RideStatus[] = ["driver_arriving", "driver_arrived", "ride_started", "ride_completed"]
  const cancelStates: RideStatus[] = ["cancelled_by_passenger", "cancelled_by_driver"]

  if (driverOnly.includes(target) && role !== "driver") {
    throw ApiError.forbidden("Only the driver can advance the ride to this status.")
  }
  if (target === "cancelled_by_passenger" && role !== "passenger") throw ApiError.forbidden()
  if (target === "cancelled_by_driver" && role !== "driver") throw ApiError.forbidden()
  void cancelStates
}

export async function updateRideStatus(params: {
  rideId: string
  actorUserId: string
  actorRole: "passenger" | "driver"
  target: RideStatus
  reason?: string
}) {
  const ride = await loadRideWithParties(params.rideId)

  const isParty =
    (params.actorRole === "passenger" && ride.passenger.userId === params.actorUserId) ||
    (params.actorRole === "driver" && ride.driver.userId === params.actorUserId)
  if (!isParty) throw ApiError.forbidden("You are not a party to this ride.")

  const current = ride.status as RideStatus
  const isCancellation = params.target === "cancelled_by_passenger" || params.target === "cancelled_by_driver"
  const allowedNext = RIDE_STATUS_TRANSITIONS[current] ?? []

  if (isCancellation) {
    const cancellableFrom: RideStatus[] = ["driver_selected", "driver_arriving", "driver_arrived"]
    if (!cancellableFrom.includes(current)) {
      throw ApiError.conflict("INVALID_STATUS_TRANSITION", `Ride cannot be cancelled once it has status "${current}".`)
    }
  } else if (!allowedNext.includes(params.target)) {
    throw ApiError.conflict("INVALID_STATUS_TRANSITION", `Cannot move ride from "${current}" to "${params.target}".`)
  }

  assertActorAllowed(params.actorRole, params.target)

  const now = new Date()
  const timestampField: Partial<Record<RideStatus, string>> = {
    driver_arrived: "arrivedAt",
    ride_started: "startedAt",
    ride_completed: "completedAt",
  }
  const extra: Record<string, unknown> = {}
  const field = timestampField[params.target]
  if (field) extra[field] = now
  if (isCancellation) {
    extra.cancelledAt = now
    extra.cancellationReason = params.reason ?? null
  }

  await prisma.$transaction([
    prisma.ride.update({ where: { id: ride.id }, data: { status: params.target, ...extra } }),
    prisma.rideStatusHistory.create({
      data: { rideId: ride.id, status: params.target, changedById: params.actorUserId, note: params.reason },
    }),
  ])

  if (isCancellation) {
    await prisma.driverProfile.update({
      where: { id: ride.driverId },
      data: {
        availabilityStatus: "online",
        cancelledRides: { increment: 1 },
      },
    })
    if (params.actorRole === "passenger") {
      await prisma.passengerProfile.update({ where: { id: ride.passengerId }, data: { cancelledRides: { increment: 1 } } })
    }
  }

  if (params.target === "ride_completed") {
    await completeRide(ride.id)
  }

  const counterpartUserId = params.actorRole === "passenger" ? ride.driver.userId : ride.passenger.userId
  await notify({
    userId: counterpartUserId,
    type: "ride_update",
    title: rideStatusTitle(params.target),
    body: params.reason,
    data: { rideId: ride.id, status: params.target },
  })
  emitToRide(ride.id, "ride.status_changed", { rideId: ride.id, status: params.target })
  emitToAdmin("ride.status_changed", { rideId: ride.id, status: params.target })

  // Same shape as GET /rides/:id — callers (including the frontend) treat
  // every ride response as carrying these relations.
  return prisma.ride.findUniqueOrThrow({
    where: { id: ride.id },
    include: {
      passenger: { include: { user: true } },
      driver: { include: { user: true } },
      vehicle: true,
      pickup: true,
      destination: true,
      payment: { include: { commission: true } },
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  })
}

function rideStatusTitle(status: RideStatus): string {
  const titles: Record<RideStatus, string> = {
    driver_selected: "Driver selected",
    driver_arriving: "Driver is on the way",
    driver_arrived: "Driver has arrived",
    ride_started: "Ride started",
    ride_completed: "Ride completed",
    cancelled_by_passenger: "Ride cancelled by passenger",
    cancelled_by_driver: "Ride cancelled by driver",
    expired: "Ride expired",
    disputed: "Ride disputed",
  }
  return titles[status]
}

/**
 * Ride completion (Phase 2 §14): computes the final fare/commission/
 * payout from the FareRule's admin-configured commission rate — never a
 * hard-coded percentage — records a Payment + Commission + driver wallet
 * Transaction, and returns the driver to "online".
 */
async function completeRide(rideId: string) {
  const ride = await prisma.ride.findUniqueOrThrow({
    where: { id: rideId },
    include: { rideRequest: true, driver: { include: { user: true, city: true } } },
  })

  const rule = await resolveFareRule(ride.rideRequest.cityId, ride.rideRequest.vehicleTypeId, ride.rideRequest.zoneId)
  const finalFare = ride.agreedFare // MVP: the agreed/negotiated price is final — see docs for rationale
  const commissionAmount = round2(finalFare * rule.commissionRate)
  const driverPayout = round2(finalFare - commissionAmount)
  const durationMin =
    ride.startedAt && ride.completedAt ? Math.max(1, Math.round((ride.completedAt.getTime() - ride.startedAt.getTime()) / 60_000)) : null

  const provider = getPaymentProvider(ride.paymentMethod)
  const authResult = await provider.authorize(finalFare, ride.id)
  const captureResult = await provider.capture(authResult.providerReference)

  await prisma.$transaction(async (tx) => {
    await tx.ride.update({ where: { id: ride.id }, data: { finalFare, durationMin } })

    const payment = await tx.payment.create({
      data: {
        rideId: ride.id,
        method: ride.paymentMethod,
        status: captureResult.status === "captured" ? "captured" : "failed",
        amount: finalFare,
        currencyCode: ride.driver.city.currencyCode,
        providerReference: captureResult.providerReference,
        capturedAt: captureResult.status === "captured" ? new Date() : null,
      },
    })

    await tx.commission.create({ data: { paymentId: payment.id, rate: rule.commissionRate, amount: commissionAmount } })

    const wallet = await tx.wallet.upsert({
      where: { userId: ride.driver.userId },
      create: { userId: ride.driver.userId, balance: 0, currencyCode: ride.driver.city.currencyCode },
      update: {},
    })
    const newBalance = round2(wallet.balance + driverPayout)
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        paymentId: payment.id,
        type: "ride_payout",
        amount: driverPayout,
        balanceAfter: newBalance,
        description: `Ride ${ride.id.slice(0, 8)} payout`,
      },
    })

    await tx.driverProfile.update({
      where: { id: ride.driverId },
      data: { availabilityStatus: "online", completedRides: { increment: 1 } },
    })
    await tx.passengerProfile.update({ where: { id: ride.passengerId }, data: { completedRides: { increment: 1 } } })
  })

  return { finalFare, commissionAmount, driverPayout }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
