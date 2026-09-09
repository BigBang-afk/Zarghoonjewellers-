import { beforeEach, describe, expect, it } from "vitest"
import request from "supertest"
import { app, auth, loginAs } from "./helpers.js"
import { resetDb, seedFixtures, samplePickup, sampleDestination, type Fixtures } from "./fixtures.js"
import { prisma } from "../src/utils/prisma.js"
import { sweepExpiredNegotiations } from "../src/services/negotiationEngine.js"

let fx: Fixtures

beforeEach(async () => {
  await resetDb()
  fx = await seedFixtures()
})

async function createQuickMatchRequest(passengerToken: string) {
  return request(app)
    .post("/v1/ride-requests")
    .set(auth(passengerToken))
    .send({
      cityId: fx.cityId,
      vehicleTypeId: fx.vehicleTypeIds.economy,
      pickup: samplePickup,
      destination: sampleDestination,
      bookingMode: "quick_match",
      paymentMethod: "cash",
    })
}

async function createCompetitiveRequest(passengerToken: string, proposedFare?: number) {
  return request(app)
    .post("/v1/ride-requests")
    .set(auth(passengerToken))
    .send({
      cityId: fx.cityId,
      vehicleTypeId: fx.vehicleTypeIds.economy,
      pickup: samplePickup,
      destination: sampleDestination,
      bookingMode: "competitive_offer",
      proposedFare,
      paymentMethod: "cash",
    })
}

describe("Critical workflow: request -> offer -> selection -> ride -> payment -> rating", () => {
  it("completes the full Quick Match happy path", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)

    const created = await createQuickMatchRequest(passengerToken)
    expect(created.status).toBe(201)
    expect(created.body.dispatch.status).toBe("dispatched")
    const rideRequestId = created.body.request.id
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId

    // The dispatched driver should be whichever fixture driver got picked.
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)

    const incoming = await request(app).get("/v1/driver/me/incoming-requests").set(auth(driverToken))
    expect(incoming.body.offers.map((o: { id: string }) => o.id)).toContain(offerId)

    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    expect(accept.status).toBe(200)
    expect(accept.body.kind).toBe("booked")
    const rideId = accept.body.ride.id

    // Ride request is now matched, driver is on_trip
    const reqRow = await prisma.rideRequest.findUniqueOrThrow({ where: { id: rideRequestId } })
    expect(reqRow.status).toBe("matched")
    const driverProfile = await prisma.driverProfile.findUniqueOrThrow({ where: { id: dispatchedDriverId } })
    expect(driverProfile.availabilityStatus).toBe("on_trip")

    // Status flow
    for (const target of ["driver_arriving", "driver_arrived", "ride_started"]) {
      const res = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target })
      expect(res.status).toBe(200)
      expect(res.body.ride.status).toBe(target)
    }
    const completed = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target: "ride_completed" })
    expect(completed.status).toBe(200)
    expect(completed.body.ride.finalFare).toBeGreaterThan(0)

    // Payment + commission were recorded
    const payment = await prisma.payment.findUnique({ where: { rideId }, include: { commission: true } })
    expect(payment?.status).toBe("captured")
    expect(payment?.commission?.amount).toBeCloseTo((payment!.amount) * 0.15, 5)

    // Driver wallet credited with payout (fare - commission)
    const driverAfter = await prisma.driverProfile.findUniqueOrThrow({ where: { id: dispatchedDriverId } })
    expect(driverAfter.availabilityStatus).toBe("online") // back online after completion
    expect(driverAfter.completedRides).toBe(1)
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverProfile.userId } })
    expect(wallet.balance).toBeCloseTo(payment!.amount - payment!.commission!.amount, 5)

    // Rating: passenger rates driver
    const rating = await request(app).post(`/v1/rides/${rideId}/ratings`).set(auth(passengerToken)).send({ score: 5, comment: "Great!" })
    expect(rating.status).toBe(201)

    // Duplicate rating rejected
    const dup = await request(app).post(`/v1/rides/${rideId}/ratings`).set(auth(passengerToken)).send({ score: 4 })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe("ALREADY_RATED")
  })

  it("supports Competitive Offer negotiation: driver counters, passenger accepts the counter", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createCompetitiveRequest(passengerToken, 500)
    expect(created.status).toBe(201)
    expect(created.body.dispatch.status).toBe("dispatched")
    expect(created.body.dispatch.driversNotified).toBeGreaterThanOrEqual(1)
    const rideRequestId = created.body.request.id

    const driver1Token = await loginAs(fx.driver1.phone)
    const driver2Token = await loginAs(fx.driver2.phone)

    const offersForRequest = await prisma.rideOffer.findMany({ where: { rideRequestId } })
    expect(offersForRequest.length).toBe(2) // both fixture drivers are eligible

    const offer1 = offersForRequest.find((o) => o.driverId === fx.driver1.profileId)!
    const offer2 = offersForRequest.find((o) => o.driverId === fx.driver2.profileId)!

    // driver1 counters at a higher price
    const counter = await request(app).post(`/v1/ride-offers/${offer1.id}/counter`).set(auth(driver1Token)).send({ counterPrice: 600 })
    expect(counter.status).toBe(201)
    const counterOfferId = counter.body.counterOffer.id

    // driver2 just accepts the original ask
    const accept2 = await request(app).post(`/v1/ride-offers/${offer2.id}/accept`).set(auth(driver2Token))
    expect(accept2.status).toBe(200)
    expect(accept2.body.kind).toBe("accepted") // competitive: no auto-booking

    // Passenger compares offers
    const offersList = await request(app).get(`/v1/ride-requests/${rideRequestId}/offers`).set(auth(passengerToken))
    expect(offersList.status).toBe(200)
    expect(offersList.body.offers.length).toBe(2)

    // Passenger accepts driver1's counter-offer (Rs 600)
    const selectCounter = await request(app).post(`/v1/counter-offers/${counterOfferId}/accept`).set(auth(passengerToken))
    expect(selectCounter.status).toBe(201)
    const ride = selectCounter.body.ride
    expect(ride.agreedFare).toBe(600)
    expect(ride.driverId).toBe(fx.driver1.profileId)

    // driver2's offer should now be expired/closed, driver2 still online
    const offer2After = await prisma.rideOffer.findUniqueOrThrow({ where: { id: offer2.id } })
    expect(offer2After.status).toBe("expired")
    const driver2After = await prisma.driverProfile.findUniqueOrThrow({ where: { id: fx.driver2.profileId } })
    expect(driver2After.availabilityStatus).toBe("online")
  })

  it("expires a stale Quick Match offer and escalates to the next driver", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const rideRequestId = created.body.request.id
    const firstOfferId = created.body.dispatch.offerId

    // Force the offer into the past instead of waiting out the real timer.
    await prisma.rideOffer.update({ where: { id: firstOfferId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await sweepExpiredNegotiations()

    const firstOffer = await prisma.rideOffer.findUniqueOrThrow({ where: { id: firstOfferId } })
    expect(firstOffer.status).toBe("expired")

    // A new offer should have been dispatched to the other driver.
    const offers = await prisma.rideOffer.findMany({ where: { rideRequestId } })
    expect(offers.length).toBe(2)
    const secondOffer = offers.find((o) => o.id !== firstOfferId)!
    expect(secondOffer.status).toBe("pending")
    expect(secondOffer.driverId).not.toBe(firstOffer.driverId)
  })

  it("lets a passenger cancel a request before it's matched", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const rideRequestId = created.body.request.id

    const cancel = await request(app).delete(`/v1/ride-requests/${rideRequestId}`).set(auth(passengerToken))
    expect(cancel.status).toBe(200)

    const reqRow = await prisma.rideRequest.findUniqueOrThrow({ where: { id: rideRequestId } })
    expect(reqRow.status).toBe("cancelled")
  })

  it("lets a driver cancel an active ride and returns them to online", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const offerId = created.body.dispatch.offerId
    const driverPhone = created.body.dispatch.driverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)

    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    const cancel = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target: "cancelled_by_driver", reason: "Vehicle issue" })
    expect(cancel.status).toBe(200)
    expect(cancel.body.ride.status).toBe("cancelled_by_driver")

    const driverProfile = await prisma.driverProfile.findUniqueOrThrow({ where: { id: created.body.dispatch.driverId } })
    expect(driverProfile.availabilityStatus).toBe("online")
    expect(driverProfile.cancelledRides).toBe(1)
  })

  it("expires the request immediately when no drivers are available", async () => {
    // Take both fixture drivers offline.
    await prisma.driverProfile.updateMany({ data: { availabilityStatus: "offline" } })
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    expect(created.status).toBe(201)
    expect(created.body.dispatch.status).toBe("no_drivers")
    expect(created.body.request.status).toBe("searching") // response body reflects pre-dispatch snapshot

    const reqRow = await prisma.rideRequest.findUniqueOrThrow({ where: { id: created.body.request.id } })
    expect(reqRow.status).toBe("expired")
  })
})

describe("Edge cases", () => {
  it("prevents double-booking the same driver from two competing requests", async () => {
    const passenger1Token = await loginAs(fx.passenger1.phone)
    const passenger2Token = await loginAs(fx.passenger2.phone)

    const req1 = await createCompetitiveRequest(passenger1Token, 500)
    const req2 = await createCompetitiveRequest(passenger2Token, 500)

    const offers1 = await prisma.rideOffer.findMany({ where: { rideRequestId: req1.body.request.id, driverId: fx.driver1.profileId } })
    const offers2 = await prisma.rideOffer.findMany({ where: { rideRequestId: req2.body.request.id, driverId: fx.driver1.profileId } })
    expect(offers1.length).toBe(1)
    expect(offers2.length).toBe(1)

    const driver1Token = await loginAs(fx.driver1.phone)
    await request(app).post(`/v1/ride-offers/${offers1[0].id}/accept`).set(auth(driver1Token))
    await request(app).post(`/v1/ride-offers/${offers2[0].id}/accept`).set(auth(driver1Token))

    // Both passengers race to select driver1's offer.
    const [select1, select2] = await Promise.all([
      request(app).post(`/v1/ride-requests/${req1.body.request.id}/select-offer`).set(auth(passenger1Token)).send({ offerId: offers1[0].id }),
      request(app).post(`/v1/ride-requests/${req2.body.request.id}/select-offer`).set(auth(passenger2Token)).send({ offerId: offers2[0].id }),
    ])

    const statuses = [select1.status, select2.status].sort()
    expect(statuses).toEqual([201, 409])

    const rides = await prisma.ride.findMany({ where: { driverId: fx.driver1.profileId } })
    expect(rides.length).toBe(1)
  })

  it("rejects unauthorized access to another passenger's ride request", async () => {
    const passenger1Token = await loginAs(fx.passenger1.phone)
    const passenger2Token = await loginAs(fx.passenger2.phone)
    const created = await createQuickMatchRequest(passenger1Token)

    const res = await request(app).get(`/v1/ride-requests/${created.body.request.id}`).set(auth(passenger2Token))
    expect(res.status).toBe(403)
  })

  it("rejects a driver accepting an offer that belongs to another driver", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const dispatchedDriverId = created.body.dispatch.driverId
    const otherDriverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver2.phone : fx.driver1.phone
    const otherDriverToken = await loginAs(otherDriverPhone)

    const res = await request(app).post(`/v1/ride-offers/${created.body.dispatch.offerId}/accept`).set(auth(otherDriverToken))
    expect(res.status).toBe(403)
  })

  it("rejects requests with no auth token", async () => {
    const res = await request(app).get("/v1/rides")
    expect(res.status).toBe(401)
  })

  it("rejects a custom fare below the configured minimum", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const res = await createCompetitiveRequest(passengerToken, 10) // minimum for economy is 250
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("FARE_BELOW_MINIMUM")
  })

  it("rejects an invalid ride status transition", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const driverPhone = created.body.dispatch.driverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)
    const accept = await request(app).post(`/v1/ride-offers/${created.body.dispatch.offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    // Can't jump straight to ride_completed from driver_selected.
    const badTransition = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target: "ride_completed" })
    expect(badTransition.status).toBe(409)
    expect(badTransition.body.error.code).toBe("INVALID_STATUS_TRANSITION")

    // A passenger can't perform a driver-only transition.
    const wrongActor = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(passengerToken)).send({ target: "driver_arriving" })
    expect(wrongActor.status).toBe(403)
  })
})
