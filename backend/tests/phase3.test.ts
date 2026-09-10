import { beforeEach, describe, expect, it } from "vitest"
import request from "supertest"
import { app, auth, loginAs } from "./helpers.js"
import { resetDb, seedFixtures, samplePickup, sampleDestination, PASSWORD, type Fixtures } from "./fixtures.js"
import { prisma } from "../src/utils/prisma.js"
import { setSetting } from "../src/config/settings.js"

let fx: Fixtures

beforeEach(async () => {
  await resetDb()
  fx = await seedFixtures()
})

async function createQuickMatchRequest(passengerToken: string, extra: Record<string, unknown> = {}) {
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
      ...extra,
    })
}

async function createCompetitiveRequest(passengerToken: string, proposedFare: number) {
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

/** Runs a full Quick Match request through to a completed ride and returns identifiers for follow-up assertions. */
async function completeAQuickMatchRide(passengerToken: string) {
  const created = await createQuickMatchRequest(passengerToken)
  const offerId = created.body.dispatch.offerId
  const dispatchedDriverId = created.body.dispatch.driverId
  const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
  const driverToken = await loginAs(driverPhone)

  const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
  const rideId = accept.body.ride.id
  for (const target of ["driver_arriving", "driver_arrived", "ride_started", "ride_completed"]) {
    await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target })
  }
  return { rideId, driverToken, driverProfileId: dispatchedDriverId as string }
}

describe("Promotions", () => {
  it("applies a valid promo code once and blocks reuse", async () => {
    await prisma.promotion.create({
      data: { code: "RIVOTEST", discountType: "percentage", discountValue: 10, cityId: fx.cityId, usageLimit: 5, isActive: true, startsAt: new Date() },
    })
    const passengerToken = await loginAs(fx.passenger1.phone)

    const first = await createQuickMatchRequest(passengerToken, { promoCode: "rivotest" })
    expect(first.status).toBe(201)
    const reqRow = await prisma.rideRequest.findUniqueOrThrow({ where: { id: first.body.request.id } })
    expect(reqRow.promotionId).not.toBeNull()
    expect(reqRow.discountAmount).toBeGreaterThan(0)

    const redemption = await prisma.promoRedemption.findFirst({ where: { userId: fx.passenger1.userId } })
    expect(redemption).not.toBeNull()

    const second = await createQuickMatchRequest(passengerToken, { promoCode: "RIVOTEST" })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe("PROMO_ALREADY_USED")
  })

  it("rejects a promo code scoped to a different city", async () => {
    const otherCity = await prisma.city.create({
      data: { countryId: fx.countryId, name: "Lahore", status: "live", currencyCode: "PKR", timezone: "Asia/Karachi" },
    })
    await prisma.promotion.create({
      data: { code: "LHRONLY", discountType: "flat", discountValue: 50, cityId: otherCity.id, isActive: true, startsAt: new Date() },
    })
    const passengerToken = await loginAs(fx.passenger1.phone)
    const res = await createQuickMatchRequest(passengerToken, { promoCode: "LHRONLY" })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("PROMO_WRONG_CITY")
  })
})

describe("Referrals", () => {
  it("rejects self-referral by matching phone number", async () => {
    const code = await prisma.referralCode.create({ data: { userId: fx.passenger1.userId, code: "SELFCODE" } })
    const res = await request(app)
      .post("/v1/account/referral/apply")
      .set(auth(await loginAs(fx.passenger1.phone)))
      .send({ code: code.code })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("SELF_REFERRAL")
  })

  it("rewards both referrer and referred wallet once the referred passenger completes a qualifying ride", async () => {
    await setSetting("referral.qualifyingRideCount", 1)
    await setSetting("referral.rewardAmountReferrer", 200)
    await setSetting("referral.rewardAmountReferred", 100)

    const code = await prisma.referralCode.create({ data: { userId: fx.passenger1.userId, code: "FRIENDCODE" } })
    const apply = await request(app)
      .post("/v1/account/referral/apply")
      .set(auth(await loginAs(fx.passenger2.phone)))
      .send({ code: code.code })
    expect(apply.status).toBe(201)

    const passenger2Token = await loginAs(fx.passenger2.phone)
    await completeAQuickMatchRide(passenger2Token)

    const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger1.userId } })
    const referredWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger2.userId } })
    expect(referrerWallet.balance).toBe(200)
    expect(referredWallet.balance).toBe(100)

    const referral = await prisma.referral.findUniqueOrThrow({ where: { referredUserId: fx.passenger2.userId } })
    expect(referral.status).toBe("rewarded")
  })
})

describe("Wallet", () => {
  it("tops up a passenger's wallet and records a transaction", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const res = await request(app).post("/v1/passenger/wallet/topup").set(auth(passengerToken)).send({ amount: 500, method: "card" })
    expect(res.status).toBe(201)
    expect(res.body.balance).toBe(500)

    const wallet = await request(app).get("/v1/passenger/wallet").set(auth(passengerToken))
    expect(wallet.body.balance).toBe(500)
    expect(wallet.body.transactions.some((t: { type: string }) => t.type === "wallet_topup")).toBe(true)
  })
})

describe("Favorite drivers", () => {
  it("only allows favoriting a driver after a completed ride together", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)

    const tooSoon = await request(app).post(`/v1/passenger/favorites/${fx.driver1.profileId}`).set(auth(passengerToken))
    expect(tooSoon.status).toBe(400)
    expect(tooSoon.body.error.code).toBe("NO_COMPLETED_RIDE")

    const { driverProfileId } = await completeAQuickMatchRide(passengerToken)
    const favorite = await request(app).post(`/v1/passenger/favorites/${driverProfileId}`).set(auth(passengerToken))
    expect(favorite.status).toBe(201)

    const list = await request(app).get("/v1/passenger/favorites").set(auth(passengerToken))
    expect(list.body.favorites.map((f: { driverId: string }) => f.driverId)).toContain(driverProfileId)
  })
})

describe("Negotiation guardrails", () => {
  it("rejects a counter-offer that deviates too far from the requested fare", async () => {
    await setSetting("negotiation.maxCounterDeviationPct", 0.1)
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createCompetitiveRequest(passengerToken, 500)
    const offers = await prisma.rideOffer.findMany({ where: { rideRequestId: created.body.request.id, driverId: fx.driver1.profileId } })
    const driver1Token = await loginAs(fx.driver1.phone)

    const res = await request(app).post(`/v1/ride-offers/${offers[0].id}/counter`).set(auth(driver1Token)).send({ counterPrice: 1000 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("COUNTER_DEVIATION_TOO_LARGE")
  })

  it("stops a driver from counter-offering past the configured round limit", async () => {
    await setSetting("negotiation.maxCounterRounds", 1)
    await setSetting("negotiation.maxCounterDeviationPct", 1)
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createCompetitiveRequest(passengerToken, 500)
    const offers = await prisma.rideOffer.findMany({ where: { rideRequestId: created.body.request.id, driverId: fx.driver1.profileId } })
    const driver1Token = await loginAs(fx.driver1.phone)

    const first = await request(app).post(`/v1/ride-offers/${offers[0].id}/counter`).set(auth(driver1Token)).send({ counterPrice: 520 })
    expect(first.status).toBe(201)

    const second = await request(app).post(`/v1/ride-offers/${offers[0].id}/counter`).set(auth(driver1Token)).send({ counterPrice: 530 })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe("COUNTER_LIMIT_REACHED")
  })
})

describe("Race conditions", () => {
  it("rejects accepting an offer that expired before the driver responded", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await createQuickMatchRequest(passengerToken)
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)

    // Simulate the offer having expired the instant before the driver's
    // accept request lands — no sweep has run yet.
    await prisma.rideOffer.update({ where: { id: offerId }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const res = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe("OFFER_EXPIRED")

    const offerRow = await prisma.rideOffer.findUniqueOrThrow({ where: { id: offerId } })
    expect(offerRow.status).toBe("expired")
  })
})

describe("Disputes", () => {
  it("lets a passenger file a dispute and an admin refund it into their wallet", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const { rideId } = await completeAQuickMatchRide(passengerToken)

    const filed = await request(app).post(`/v1/rides/${rideId}/disputes`).set(auth(passengerToken)).send({ reason: "Driver took a longer route" })
    expect(filed.status).toBe(201)
    const disputeId = filed.body.dispute.id

    const adminToken = await loginAs(fx.admin.phone)
    const refund = await request(app)
      .post(`/v1/admin/disputes/${disputeId}/refund`)
      .set(auth(adminToken))
      .send({ resolution: "Verified longer route, refunding in full" })
    expect(refund.status).toBe(200)
    expect(refund.body.dispute.status).toBe("resolved")
    expect(refund.body.dispute.decision).toBe("refund_passenger")

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger1.userId } })
    expect(wallet.balance).toBeGreaterThan(0)
  })
})

describe("Admin RBAC", () => {
  async function makeSupportAgent() {
    const user = await prisma.user.create({
      data: {
        fullName: "Support Agent", phone: "+923100000098", role: "admin", status: "active", phoneVerifiedAt: new Date(),
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: fx.admin.userId } })).passwordHash,
        adminProfile: { create: { role: "support_agent" } },
      },
    })
    return user.phone
  }

  it("blocks a support_agent admin from changing platform settings, but allows a super_admin", async () => {
    const supportPhone = await makeSupportAgent()
    const supportToken = await request(app).post("/v1/auth/login").send({ phone: supportPhone, password: PASSWORD })
    expect(supportToken.status).toBe(200)

    const blocked = await request(app)
      .put("/v1/admin/settings/matching.initialRadiusKm")
      .set(auth(supportToken.body.accessToken))
      .send({ value: 5 })
    expect(blocked.status).toBe(403)

    const superAdminToken = await loginAs(fx.admin.phone)
    const allowed = await request(app)
      .put("/v1/admin/settings/matching.initialRadiusKm")
      .set(auth(superAdminToken))
      .send({ value: 5 })
    expect(allowed.status).toBe(200)
  })

  it("lets a support_agent update a support ticket's status", async () => {
    const ticket = await prisma.supportTicket.create({
      data: { userId: fx.passenger1.userId, category: "technical", subject: "Can't see fare", status: "open" },
    })
    const supportPhone = await makeSupportAgent()
    const supportToken = await request(app).post("/v1/auth/login").send({ phone: supportPhone, password: PASSWORD })

    const res = await request(app)
      .patch(`/v1/admin/support-tickets/${ticket.id}`)
      .set(auth(supportToken.body.accessToken))
      .send({ status: "in_progress" })
    expect(res.status).toBe(200)
    expect(res.body.ticket.status).toBe("in_progress")
  })
})
