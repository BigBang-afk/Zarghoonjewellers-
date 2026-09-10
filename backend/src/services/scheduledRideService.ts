import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { computeFare, assertFareWithinGuardrails } from "./fareEngine.js"
import { mapProvider } from "./maps/HaversineMapProvider.js"
import { createRideRequest } from "./rideRequestService.js"
import { notify } from "./notifications/NotificationService.js"
import type { BookingMode } from "../types/enums.js"

export interface CreateScheduledRideInput {
  passengerId: string
  passengerUserId: string
  cityId: string
  zoneId?: string | null
  vehicleTypeId: string
  pickup: { address: string; lat: number; lng: number }
  destination: { address: string; lat: number; lng: number }
  bookingMode: BookingMode
  proposedFare?: number
  scheduledFor: Date
}

/** Scheduled rides (Phase 2 §13) — a ride request isn't created until dispatch time. */
export async function createScheduledRide(input: CreateScheduledRideInput) {
  if (input.scheduledFor.getTime() < Date.now() + 10 * 60_000) {
    throw ApiError.badRequest("SCHEDULE_TOO_SOON", "Scheduled rides must be booked at least 10 minutes in advance.")
  }

  const vehicleType = await prisma.vehicleType.findUnique({ where: { id: input.vehicleTypeId } })
  if (!vehicleType || !vehicleType.isActive) throw ApiError.badRequest("INVALID_VEHICLE_TYPE", "Vehicle type not available.")

  if (input.bookingMode === "competitive_offer" && input.proposedFare != null) {
    const route = await mapProvider.estimateRoute(input.pickup, input.destination, vehicleType.code)
    const fare = await computeFare({ cityId: input.cityId, vehicleTypeId: input.vehicleTypeId, zoneId: input.zoneId, distanceKm: route.distanceKm, durationMin: route.durationMin })
    assertFareWithinGuardrails(input.proposedFare, fare)
  }

  const [pickup, destination] = await Promise.all([
    prisma.location.create({ data: { userId: input.passengerUserId, address: input.pickup.address, lat: input.pickup.lat, lng: input.pickup.lng } }),
    prisma.location.create({ data: { userId: input.passengerUserId, address: input.destination.address, lat: input.destination.lat, lng: input.destination.lng } }),
  ])

  return prisma.scheduledRide.create({
    data: {
      passengerId: input.passengerId,
      cityId: input.cityId,
      zoneId: input.zoneId,
      vehicleTypeId: input.vehicleTypeId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      bookingMode: input.bookingMode,
      proposedFare: input.proposedFare,
      scheduledFor: input.scheduledFor,
      status: "scheduled",
    },
    include: { pickup: true, destination: true, vehicleType: true },
  })
}

export async function cancelScheduledRide(scheduledRideId: string, passengerId: string) {
  const scheduled = await prisma.scheduledRide.findUnique({ where: { id: scheduledRideId } })
  if (!scheduled) throw ApiError.notFound("Scheduled ride not found.")
  if (scheduled.passengerId !== passengerId) throw ApiError.forbidden()
  if (scheduled.status !== "scheduled") throw ApiError.conflict("NOT_CANCELLABLE", "This scheduled ride can no longer be cancelled.")
  return prisma.scheduledRide.update({ where: { id: scheduledRideId }, data: { status: "cancelled" } })
}

export async function rescheduleRide(scheduledRideId: string, passengerId: string, scheduledFor: Date) {
  const scheduled = await prisma.scheduledRide.findUnique({ where: { id: scheduledRideId } })
  if (!scheduled) throw ApiError.notFound("Scheduled ride not found.")
  if (scheduled.passengerId !== passengerId) throw ApiError.forbidden()
  if (scheduled.status !== "scheduled") throw ApiError.conflict("NOT_RESCHEDULABLE", "This scheduled ride can no longer be rescheduled.")
  if (scheduledFor.getTime() < Date.now() + 10 * 60_000) {
    throw ApiError.badRequest("SCHEDULE_TOO_SOON", "Scheduled rides must be booked at least 10 minutes in advance.")
  }
  return prisma.scheduledRide.update({ where: { id: scheduledRideId }, data: { scheduledFor } })
}

/**
 * Dispatch sweep (Phase 2 §13: "before dispatch, notify eligible drivers
 * according to configurable rules") — invoked on an interval from
 * server.ts alongside the negotiation sweeper. Turns a due ScheduledRide
 * into a real RideRequest through the exact same creation path a normal
 * booking uses, so it gets the same fare computation and dispatch logic.
 */
export async function dispatchDueScheduledRides(): Promise<void> {
  const leadMinutes = await getSetting("scheduledRide.dispatchLeadMinutes")
  const cutoff = new Date(Date.now() + leadMinutes * 60_000)

  const due = await prisma.scheduledRide.findMany({
    where: { status: "scheduled", scheduledFor: { lte: cutoff } },
    include: { pickup: true, destination: true, passenger: { include: { user: true } } },
  })

  for (const scheduled of due) {
    try {
      const result = await createRideRequest({
        passengerId: scheduled.passengerId,
        passengerUserId: scheduled.passenger.userId,
        cityId: scheduled.cityId,
        zoneId: scheduled.zoneId,
        vehicleTypeId: scheduled.vehicleTypeId,
        pickup: scheduled.pickup,
        destination: scheduled.destination,
        bookingMode: scheduled.bookingMode as BookingMode,
        proposedFare: scheduled.proposedFare ?? undefined,
        paymentMethod: "cash",
        scheduledRideId: scheduled.id,
      })
      await prisma.scheduledRide.update({ where: { id: scheduled.id }, data: { status: "dispatched" } })
      await notify({
        userId: scheduled.passenger.userId,
        type: "ride_update",
        title: "Your scheduled ride is being dispatched",
        body: `Looking for a driver for your ${scheduled.scheduledFor.toLocaleTimeString()} ride now.`,
        data: { scheduledRideId: scheduled.id, rideRequestId: result.request.id },
      })
    } catch (err) {
      // A single bad scheduled ride (e.g. city went offline) shouldn't
      // block the rest of the sweep from running.
      await prisma.scheduledRide.update({ where: { id: scheduled.id }, data: { status: "expired" } })
      await notify({
        userId: scheduled.passenger.userId,
        type: "ride_update",
        title: "Couldn't dispatch your scheduled ride",
        body: err instanceof Error ? err.message : "Please try booking again.",
        data: { scheduledRideId: scheduled.id },
      })
    }
  }
}
