import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { resolveFareRule, assertFareWithinGuardrails } from "./fareEngine.js"
import { dispatchQuickMatchNext, expireRequest } from "./rideRequestService.js"
import { selectOffer } from "./bookingService.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToUser } from "../realtime/socket.js"
import { recordRiskEvent } from "./riskService.js"

async function loadOfferOrThrow(offerId: string) {
  const offer = await prisma.rideOffer.findUnique({
    where: { id: offerId },
    include: { rideRequest: true, driver: { include: { user: true } }, vehicle: true },
  })
  if (!offer) throw ApiError.notFound("Offer not found.")
  return offer
}

function assertOwnsOffer(offer: { driverId: string }, driverProfileId: string) {
  if (offer.driverId !== driverProfileId) throw ApiError.forbidden("This is not your offer.")
}

// ---------------------------------------------------------------------
// Driver responses
// ---------------------------------------------------------------------

export async function driverAcceptOffer(offerId: string, driverProfileId: string) {
  const offer = await loadOfferOrThrow(offerId)
  assertOwnsOffer(offer, driverProfileId)
  if (offer.status !== "pending") throw ApiError.conflict("OFFER_NOT_PENDING", "This offer has already been resolved.")
  if (offer.expiresAt < new Date()) {
    await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "expired" } })
    throw ApiError.conflict("OFFER_EXPIRED", "This offer has expired.")
  }

  await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "accepted" } })

  const passenger = await prisma.passengerProfile.findUniqueOrThrow({ where: { id: offer.rideRequest.passengerId } })

  if (offer.rideRequest.bookingMode === "quick_match") {
    // Quick Match: the system books this driver immediately — there is
    // no separate passenger "pick from a list" step (docs/01 §2 Mode 1).
    const ride = await selectOffer({ rideRequestId: offer.rideRequestId, passengerId: passenger.id, offerId: offer.id })
    return { kind: "booked" as const, ride }
  }

  // Competitive Offer: surface to the passenger; they still choose.
  await notify({
    userId: passenger.userId,
    type: "offer_update",
    title: "Driver accepted your offer",
    body: `${offer.driver.user.fullName} accepted Rs ${offer.offerPrice}`,
    data: { rideRequestId: offer.rideRequestId, offerId: offer.id },
  })
  emitToUser(passenger.userId, "ride_offer.accepted", { rideRequestId: offer.rideRequestId, offerId: offer.id })
  return { kind: "accepted" as const, offer }
}

export async function driverCounterOffer(offerId: string, driverProfileId: string, counterPrice: number) {
  const offer = await loadOfferOrThrow(offerId)
  assertOwnsOffer(offer, driverProfileId)
  if (offer.status !== "pending") throw ApiError.conflict("OFFER_NOT_PENDING", "This offer has already been resolved.")
  if (offer.expiresAt < new Date()) {
    await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "expired" } })
    throw ApiError.conflict("OFFER_EXPIRED", "This offer has expired.")
  }

  const rule = await resolveFareRule(offer.rideRequest.cityId, offer.rideRequest.vehicleTypeId, offer.rideRequest.zoneId)
  assertFareWithinGuardrails(counterPrice, rule)

  const maxDeviationPct = await getSetting("negotiation.maxCounterDeviationPct")
  const maxDeviation = offer.offerPrice * maxDeviationPct
  if (Math.abs(counterPrice - offer.offerPrice) > maxDeviation) {
    await recordRiskEvent(offer.driver.userId, "abnormal_offer_behavior", "low", {
      offerPrice: offer.offerPrice,
      attemptedCounterPrice: counterPrice,
      maxDeviationPct,
    })
    throw ApiError.badRequest(
      "COUNTER_DEVIATION_TOO_LARGE",
      `Counter-offers must be within ${Math.round(maxDeviationPct * 100)}% of the requested fare (Rs ${offer.offerPrice}).`,
    )
  }

  const maxRounds = await getSetting("negotiation.maxCounterRounds")
  const existingRounds = await prisma.counterOffer.count({ where: { rideOfferId: offer.id } })
  if (existingRounds >= maxRounds) {
    throw ApiError.conflict("COUNTER_LIMIT_REACHED", "This request has reached its maximum number of counter-offers.")
  }

  const expirySec = await getSetting("negotiation.counterOfferExpirySec")
  const counterOffer = await prisma.counterOffer.create({
    data: { rideOfferId: offer.id, counterPrice, status: "pending", expiresAt: new Date(Date.now() + expirySec * 1000) },
  })

  const passenger = await prisma.passengerProfile.findUniqueOrThrow({ where: { id: offer.rideRequest.passengerId } })
  await notify({
    userId: passenger.userId,
    type: "offer_update",
    title: "Counter-offer received",
    body: `${offer.driver.user.fullName} offered Rs ${counterPrice} (ETA ${offer.etaMin} min)`,
    data: { rideRequestId: offer.rideRequestId, offerId: offer.id, counterOfferId: counterOffer.id },
  })
  emitToUser(passenger.userId, "counter_offer.created", {
    rideRequestId: offer.rideRequestId,
    offerId: offer.id,
    counterOfferId: counterOffer.id,
    counterPrice,
    driver: { name: offer.driver.user.fullName, rating: offer.driver.ratingAvg, vehicle: `${offer.vehicle.make} ${offer.vehicle.model}` },
    etaMin: offer.etaMin,
  })

  return counterOffer
}

export async function driverDeclineOffer(offerId: string, driverProfileId: string) {
  const offer = await loadOfferOrThrow(offerId)
  assertOwnsOffer(offer, driverProfileId)
  if (offer.status !== "pending") throw ApiError.conflict("OFFER_NOT_PENDING", "This offer has already been resolved.")

  await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "declined" } })

  if (offer.rideRequest.bookingMode === "quick_match") {
    await dispatchQuickMatchNext(offer.rideRequestId)
  }

  return { ok: true }
}

// ---------------------------------------------------------------------
// Passenger responses to a counter-offer
// ---------------------------------------------------------------------

export async function passengerAcceptCounterOffer(counterOfferId: string, passengerProfileId: string) {
  const counterOffer = await prisma.counterOffer.findUnique({
    where: { id: counterOfferId },
    include: { rideOffer: { include: { rideRequest: true } } },
  })
  if (!counterOffer) throw ApiError.notFound("Counter-offer not found.")
  if (counterOffer.rideOffer.rideRequest.passengerId !== passengerProfileId) throw ApiError.forbidden()

  return selectOffer({
    rideRequestId: counterOffer.rideOffer.rideRequestId,
    passengerId: passengerProfileId,
    counterOfferId: counterOffer.id,
  })
}

export async function passengerRejectCounterOffer(counterOfferId: string, passengerProfileId: string) {
  const counterOffer = await prisma.counterOffer.findUnique({
    where: { id: counterOfferId },
    include: { rideOffer: { include: { rideRequest: true, driver: { include: { user: true } } } } },
  })
  if (!counterOffer) throw ApiError.notFound("Counter-offer not found.")
  if (counterOffer.rideOffer.rideRequest.passengerId !== passengerProfileId) throw ApiError.forbidden()
  if (counterOffer.status !== "pending") throw ApiError.conflict("COUNTER_OFFER_NOT_PENDING", "This counter-offer was already resolved.")

  await prisma.$transaction([
    prisma.counterOffer.update({ where: { id: counterOffer.id }, data: { status: "withdrawn" } }),
    prisma.rideOffer.update({ where: { id: counterOffer.rideOfferId }, data: { status: "declined" } }),
  ])

  emitToUser(counterOffer.rideOffer.driver.user.id, "counter_offer.rejected", { offerId: counterOffer.rideOfferId })
  return { ok: true }
}

// ---------------------------------------------------------------------
// Expiry sweeper — MVP timer mechanism (docs/06 §4: "all timers are
// server-owned"). Invoked on an interval from server.ts.
// ---------------------------------------------------------------------

// Phase 4 §29 — a batch cap on each sweep query. The sweep runs every 5s,
// so a backlog this large would mean the sweep itself has been stalled
// far longer than normal; capping the batch keeps one slow tick bounded
// instead of trying to process an unbounded pile in a single pass — the
// next tick (or the one after) works through the rest.
const SWEEP_BATCH_SIZE = 200

export async function sweepExpiredNegotiations(): Promise<void> {
  const now = new Date()

  const expiredCounters = await prisma.counterOffer.findMany({
    where: { status: "pending", expiresAt: { lt: now } },
    include: { rideOffer: { include: { rideRequest: true, driver: { include: { user: true } } } } },
    take: SWEEP_BATCH_SIZE,
  })
  for (const co of expiredCounters) {
    await prisma.counterOffer.update({ where: { id: co.id }, data: { status: "expired" } })
    emitToUser(co.rideOffer.driver.user.id, "counter_offer.expired", { offerId: co.rideOfferId })
  }

  const expiredOffers = await prisma.rideOffer.findMany({
    where: { status: "pending", expiresAt: { lt: now } },
    include: { rideRequest: true, driver: { include: { user: true } } },
    take: SWEEP_BATCH_SIZE,
  })
  for (const offer of expiredOffers) {
    await prisma.rideOffer.update({ where: { id: offer.id }, data: { status: "expired" } })
    emitToUser(offer.driver.user.id, "ride_offer.expired", { offerId: offer.id })
    if (offer.rideRequest.bookingMode === "quick_match" && offer.rideRequest.status === "searching") {
      await dispatchQuickMatchNext(offer.rideRequestId)
    }
  }

  const expiredRequests = await prisma.rideRequest.findMany({
    where: { status: { in: ["searching", "offers_open"] }, expiresAt: { lt: now } },
    take: SWEEP_BATCH_SIZE,
  })
  for (const request of expiredRequests) {
    await expireRequest(request.id, "Your ride request expired before a driver was confirmed.")
  }
}
