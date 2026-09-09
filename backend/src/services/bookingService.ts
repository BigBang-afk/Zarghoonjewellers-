import { randomUUID } from "node:crypto"
import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToUser, emitToAdmin } from "../realtime/socket.js"

/**
 * Booking creation (Phase 2 §10) — the single place a Ride gets created.
 * Runs as one interactive transaction with two atomic "claim" guards
 * (conditional updateMany calls) so that:
 *   - the same RideRequest can never be booked twice, and
 *   - the same driver can never be double-booked by two passengers
 *     racing to select an offer for them at the same instant.
 * Either guard failing rolls back the whole transaction (Prisma
 * interactive transactions roll back on a thrown error), so a lost race
 * leaves no partial state behind.
 */
export async function selectOffer(params: {
  rideRequestId: string
  passengerId: string // PassengerProfile.id — ownership check
  offerId?: string
  counterOfferId?: string
}) {
  if (!params.offerId && !params.counterOfferId) {
    throw ApiError.badRequest("MISSING_SELECTION", "Provide either offerId or counterOfferId.")
  }

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.rideRequest.findUnique({ where: { id: params.rideRequestId } })
    if (!request) throw ApiError.notFound("Ride request not found.")
    if (request.passengerId !== params.passengerId) throw ApiError.forbidden("This is not your ride request.")
    if (!["searching", "offers_open"].includes(request.status)) {
      throw ApiError.conflict("REQUEST_NOT_OPEN", "This ride request is no longer open.")
    }

    let offer = params.offerId
      ? await tx.rideOffer.findUnique({ where: { id: params.offerId } })
      : null
    let counterOffer = params.counterOfferId
      ? await tx.counterOffer.findUnique({ where: { id: params.counterOfferId }, include: { rideOffer: true } })
      : null

    let agreedFare: number
    if (counterOffer) {
      if (counterOffer.rideOffer.rideRequestId !== params.rideRequestId) throw ApiError.notFound("Counter-offer not found.")
      if (counterOffer.status !== "pending") throw ApiError.conflict("COUNTER_OFFER_NOT_AVAILABLE", "This counter-offer is no longer available.")
      if (counterOffer.expiresAt < new Date()) throw ApiError.conflict("COUNTER_OFFER_EXPIRED", "This counter-offer has expired.")
      offer = counterOffer.rideOffer
      agreedFare = counterOffer.counterPrice
    } else {
      if (!offer || offer.rideRequestId !== params.rideRequestId) throw ApiError.notFound("Offer not found.")
      if (offer.status !== "accepted") throw ApiError.conflict("OFFER_NOT_AVAILABLE", "This offer is no longer available.")
      if (offer.expiresAt < new Date()) throw ApiError.conflict("OFFER_EXPIRED", "This offer has expired.")
      agreedFare = offer.offerPrice
    }

    // --- Atomic guard 1: this request hasn't already been claimed ---
    const claimedRequest = await tx.rideRequest.updateMany({
      where: { id: params.rideRequestId, status: { in: ["searching", "offers_open"] } },
      data: { status: "matched" },
    })
    if (claimedRequest.count === 0) throw ApiError.conflict("REQUEST_ALREADY_MATCHED", "This request was already matched.")

    // --- Atomic guard 2: the driver hasn't been claimed by another passenger ---
    const claimedDriver = await tx.driverProfile.updateMany({
      where: { id: offer!.driverId, availabilityStatus: "online" },
      data: { availabilityStatus: "on_trip" },
    })
    if (claimedDriver.count === 0) {
      throw ApiError.conflict("DRIVER_NO_LONGER_AVAILABLE", "This driver is no longer available. Please choose another offer.")
    }

    await tx.rideOffer.update({ where: { id: offer!.id }, data: { status: "accepted" } })
    if (counterOffer) await tx.counterOffer.update({ where: { id: counterOffer.id }, data: { status: "accepted" } })

    // Close out every other live offer/counter on this request.
    const others = await tx.rideOffer.findMany({
      where: { rideRequestId: params.rideRequestId, id: { not: offer!.id }, status: { in: ["pending", "accepted"] } },
    })
    if (others.length > 0) {
      const otherIds = others.map((o) => o.id)
      await tx.rideOffer.updateMany({ where: { id: { in: otherIds } }, data: { status: "expired" } })
      await tx.counterOffer.updateMany({ where: { rideOfferId: { in: otherIds }, status: "pending" }, data: { status: "expired" } })
    }

    const passenger = await tx.passengerProfile.findUniqueOrThrow({ where: { id: params.passengerId } })

    const ride = await tx.ride.create({
      data: {
        rideRequestId: params.rideRequestId,
        rideOfferId: offer!.id,
        passengerId: params.passengerId,
        driverId: offer!.driverId,
        vehicleId: offer!.vehicleId,
        pickupLocationId: request.pickupLocationId,
        destinationLocationId: request.destinationLocationId,
        agreedFare,
        distanceKm: offer!.distanceKm,
        paymentMethod: request.paymentMethod,
        status: "driver_selected",
        shareToken: randomUUID(),
        statusHistory: { create: { status: "driver_selected", changedById: passenger.userId, note: "Ride booked" } },
      },
      include: {
        passenger: { include: { user: true } },
        driver: { include: { user: true } },
        vehicle: true,
        pickup: true,
        destination: true,
      },
    })

    return { ride, passengerUserId: passenger.userId }
  })

  const { ride, passengerUserId } = result

  await notify({
    userId: passengerUserId,
    type: "ride_update",
    title: "Driver selected",
    body: `${ride.driver.user.fullName} is on the way in a ${ride.vehicle.color ?? ""} ${ride.vehicle.model}`.trim(),
    data: { rideId: ride.id },
  })
  await notify({
    userId: ride.driver.user.id,
    type: "ride_update",
    title: "Ride booked",
    body: "You've been selected for a ride. Head to pickup.",
    data: { rideId: ride.id },
  })
  emitToUser(passengerUserId, "ride.booked", { rideId: ride.id })
  emitToUser(ride.driver.user.id, "ride.booked", { rideId: ride.id })
  emitToAdmin("ride.status_changed", { rideId: ride.id, status: ride.status })

  return ride
}
