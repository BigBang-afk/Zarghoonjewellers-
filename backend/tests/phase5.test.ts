import { beforeEach, describe, expect, it } from "vitest"
import request from "supertest"
import { app, auth, loginAs } from "./helpers.js"
import { resetDb, seedFixtures, samplePickup, sampleDestination, type Fixtures } from "./fixtures.js"
import { prisma } from "../src/utils/prisma.js"
import { generatePartnerApiKey } from "../src/services/partnerApiKeyService.js"

let fx: Fixtures

beforeEach(async () => {
  await resetDb()
  fx = await seedFixtures()
})

async function putSetting(adminToken: string, key: string, value: unknown) {
  const res = await request(app).put(`/v1/admin/settings/${key}`).set(auth(adminToken)).send({ value })
  expect(res.status).toBe(200)
}

/** Drives a request through to a completed ride — the shared setup every Phase 5 feature that hangs off a real ride (lost & found, cancellation fees) needs. */
async function completeAQuickMatchRide(passengerToken: string) {
  const created = await request(app)
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
  expect(created.status).toBe(201)
  const offerId = created.body.dispatch.offerId
  const dispatchedDriverId = created.body.dispatch.driverId
  const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
  const driverUserId = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.userId : fx.driver2.userId
  const driverToken = await loginAs(driverPhone)

  const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
  expect(accept.status).toBe(200)
  const rideId = accept.body.ride.id

  for (const target of ["driver_arriving", "driver_arrived", "ride_started"]) {
    const res = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target })
    expect(res.status).toBe(200)
  }
  const completed = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target: "ride_completed" })
  expect(completed.status).toBe(200)

  return { rideId, driverToken, driverUserId }
}

describe("Feature flags — deterministic rollout and role targeting", () => {
  it("evaluates a fully-enabled flag as true and a fully-disabled one as false, per role", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const passengerToken = await loginAs(fx.passenger1.phone)

    await request(app)
      .post("/v1/admin/feature-flags")
      .set(auth(adminToken))
      .send({ key: "always_on", name: "Always on", isEnabled: true, rolloutPct: 100, targetRole: "all" })
      .expect(201)
    await request(app)
      .post("/v1/admin/feature-flags")
      .set(auth(adminToken))
      .send({ key: "always_off", name: "Always off", isEnabled: true, rolloutPct: 0, targetRole: "all" })
      .expect(201)
    await request(app)
      .post("/v1/admin/feature-flags")
      .set(auth(adminToken))
      .send({ key: "drivers_only", name: "Drivers only", isEnabled: true, rolloutPct: 100, targetRole: "driver" })
      .expect(201)

    const flags = await request(app).get("/v1/account/feature-flags").set(auth(passengerToken))
    expect(flags.status).toBe(200)
    expect(flags.body.flags.always_on).toBe(true)
    expect(flags.body.flags.always_off).toBe(false)
    expect(flags.body.flags.drivers_only).toBe(false) // targetRole excludes this passenger
  })

  it("rejects an invalid flag key at creation", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const res = await request(app)
      .post("/v1/admin/feature-flags")
      .set(auth(adminToken))
      .send({ key: "Not A Valid Key!", name: "Bad", isEnabled: true })
    expect(res.status).toBe(400)
  })

  it("an admin caller always reads an empty flag set (flags are for app users, not the admin console)", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    await request(app)
      .post("/v1/admin/feature-flags")
      .set(auth(adminToken))
      .send({ key: "some_flag", name: "Some flag", isEnabled: true, rolloutPct: 100 })
      .expect(201)
    const res = await request(app).get("/v1/account/feature-flags").set(auth(adminToken))
    expect(res.body.flags).toEqual({})
  })
})

describe("A/B testing — sticky variant assignment", () => {
  async function createRunningExperiment(adminToken: string) {
    const create = await request(app)
      .post("/v1/admin/experiments")
      .set(auth(adminToken))
      .send({
        key: "checkout_v2",
        name: "New checkout",
        variants: [
          { key: "control", name: "Control", weight: 50 },
          { key: "treatment", name: "Treatment", weight: 50 },
        ],
        targetRole: "passenger",
      })
    expect(create.status).toBe(201)
    const id = create.body.experiment.id
    const start = await request(app).patch(`/v1/admin/experiments/${id}`).set(auth(adminToken)).send({ status: "running" })
    expect(start.status).toBe(200)
    return id
  }

  it("assigns a variant on first evaluation and returns the same one on every later call, even after weights change", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const passengerToken = await loginAs(fx.passenger1.phone)
    const experimentId = await createRunningExperiment(adminToken)

    const first = await request(app).get("/v1/account/experiments").set(auth(passengerToken))
    expect(first.status).toBe(200)
    const assignedVariant = first.body.assignments.checkout_v2
    expect(["control", "treatment"]).toContain(assignedVariant)

    // Skew weights heavily toward the other variant — an already-assigned user must not be re-rolled.
    const otherVariant = assignedVariant === "control" ? "treatment" : "control"
    await request(app)
      .patch(`/v1/admin/experiments/${experimentId}`)
      .set(auth(adminToken))
      .send({
        variants: [
          { key: assignedVariant, name: assignedVariant, weight: 1 },
          { key: otherVariant, name: otherVariant, weight: 99 },
        ],
      })
      .expect(200)

    const second = await request(app).get("/v1/account/experiments").set(auth(passengerToken))
    expect(second.body.assignments.checkout_v2).toBe(assignedVariant)

    const results = await request(app).get(`/v1/admin/experiments/${experimentId}`).set(auth(adminToken))
    expect(results.body.totalAssigned).toBe(1)
    expect(results.body.results[0].variantKey).toBe(assignedVariant)
  })

  it("never assigns a role the experiment doesn't target", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    await createRunningExperiment(adminToken) // targetRole: "passenger"
    const driverToken = await loginAs(fx.driver1.phone)

    const res = await request(app).get("/v1/account/experiments").set(auth(driverToken))
    expect(res.body.assignments).toEqual({})
  })

  it("rejects variant weights that don't sum to 100", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const res = await request(app)
      .post("/v1/admin/experiments")
      .set(auth(adminToken))
      .send({
        key: "bad_weights",
        name: "Bad",
        variants: [
          { key: "a", name: "A", weight: 40 },
          { key: "b", name: "B", weight: 40 },
        ],
      })
    expect(res.status).toBe(400)
  })
})

describe("Partner API platform — scoped external booking", () => {
  it("authenticates with a generated key, gets a fare estimate, and books an existing passenger — an invalid key is rejected without crashing the process", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const partner = await prisma.partner.create({
      data: { name: "Test Partner Co", code: "TESTCO", type: "business", commissionType: "flat_per_referral", commissionValue: 100, createdById: fx.admin.userId },
    })
    const { rawKey } = await generatePartnerApiKey(partner.id)

    // An invalid key must be rejected cleanly, not crash the shared app instance
    // (regression test for a real bug found this phase: an unwrapped async
    // auth middleware threw inside a rejected promise Express never awaited).
    const invalid = await request(app)
      .post("/v1/partner-api/fare-estimate")
      .set("Authorization", "Bearer rivo_partner_totallyfake")
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination })
    expect(invalid.status).toBe(401)

    // The app must still be alive and answering for a real request right after.
    const estimate = await request(app)
      .post("/v1/partner-api/fare-estimate")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination })
    expect(estimate.status).toBe(200)
    expect(estimate.body.fare.suggestedFare).toBeGreaterThan(0)

    const booked = await request(app)
      .post("/v1/partner-api/rides")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({
        passengerPhone: fx.passenger1.phone,
        cityId: fx.cityId,
        vehicleTypeId: fx.vehicleTypeIds.economy,
        pickup: samplePickup,
        destination: sampleDestination,
      })
    expect(booked.status).toBe(201)

    const rideRequest = await prisma.rideRequest.findUniqueOrThrow({ where: { id: booked.body.request.id } })
    expect(rideRequest.partnerId).toBe(partner.id)

    const status = await request(app).get(`/v1/partner-api/rides/${booked.body.request.id}`).set("Authorization", `Bearer ${rawKey}`)
    expect(status.status).toBe(200)

    void adminToken
  })

  it("refuses to book for a phone number with no RIVO passenger account — never creates one", async () => {
    const partner = await prisma.partner.create({
      data: { name: "Test Partner Co", code: "TESTCO2", type: "business", commissionType: "flat_per_referral", commissionValue: 100, createdById: fx.admin.userId },
    })
    const { rawKey } = await generatePartnerApiKey(partner.id)

    const res = await request(app)
      .post("/v1/partner-api/rides")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({
        passengerPhone: "+920000000000",
        cityId: fx.cityId,
        vehicleTypeId: fx.vehicleTypeIds.economy,
        pickup: samplePickup,
        destination: sampleDestination,
      })
    expect(res.status).toBe(404)
    const userCountForPhone = await prisma.user.count({ where: { phone: "+920000000000" } })
    expect(userCountForPhone).toBe(0)
  })

  it("stops working immediately once the key is revoked", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    const partner = await prisma.partner.create({
      data: { name: "Revoke Co", code: "REVOKECO", type: "business", commissionType: "flat_per_referral", commissionValue: 100, createdById: fx.admin.userId },
    })
    const { rawKey } = await generatePartnerApiKey(partner.id)

    await request(app).post(`/v1/admin/partners/${partner.id}/api-key/revoke`).set(auth(adminToken)).expect(204)

    const res = await request(app)
      .post("/v1/partner-api/fare-estimate")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination })
    expect(res.status).toBe(401)
  })
})

describe("Lost & found workflow", () => {
  it("lets a passenger report a lost item after a completed ride, the driver respond, and the passenger resolve it", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const { rideId, driverToken } = await completeAQuickMatchRide(passengerToken)

    const report = await request(app)
      .post(`/v1/rides/${rideId}/lost-item`)
      .set(auth(passengerToken))
      .send({ itemCategory: "electronics", itemDescription: "Black phone left on the back seat" })
    expect(report.status).toBe(201)
    const reportId = report.body.report.id

    const driverView = await request(app).get("/v1/driver/me/lost-item-reports").set(auth(driverToken))
    expect(driverView.body.reports.map((r: { id: string }) => r.id)).toContain(reportId)

    const respond = await request(app).post(`/v1/driver/lost-item-reports/${reportId}/respond`).set(auth(driverToken)).send({ found: true })
    expect(respond.status).toBe(200)
    expect(respond.body.report.status).toBe("driver_confirmed_found")

    const resolve = await request(app).post(`/v1/lost-item-reports/${reportId}/resolve`).set(auth(passengerToken)).send({ status: "returned" })
    expect(resolve.status).toBe(200)
    expect(resolve.body.report.status).toBe("returned")
  })

  it("refuses to report a lost item before the ride is completed", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const created = await request(app)
      .post("/v1/ride-requests")
      .set(auth(passengerToken))
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination, bookingMode: "quick_match", paymentMethod: "cash" })
    expect(created.status).toBe(201)
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)
    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    const res = await request(app)
      .post(`/v1/rides/${rideId}/lost-item`)
      .set(auth(passengerToken))
      .send({ itemCategory: "electronics", itemDescription: "Too early" })
    expect(res.status).toBe(409)
  })
})

describe("Smart cancellation management", () => {
  it("charges a configured late-cancellation fee into the driver's wallet for a non-exempt reason, once the policy is enabled and the free window has passed", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    await putSetting(adminToken, "cancellation.penaltyEnabled", true)
    await putSetting(adminToken, "cancellation.freeWindowSec", 0)
    await putSetting(adminToken, "cancellation.passengerFeeAmount", 50)

    await prisma.wallet.update({ where: { userId: fx.passenger1.userId }, data: { balance: 200 } })
    const passengerToken = await loginAs(fx.passenger1.phone)

    const created = await request(app)
      .post("/v1/ride-requests")
      .set(auth(passengerToken))
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination, bookingMode: "quick_match", paymentMethod: "cash" })
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverUserId = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.userId : fx.driver2.userId
    const driverToken = await loginAs(driverPhone)
    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    const cancel = await request(app)
      .post(`/v1/rides/${rideId}/status`)
      .set(auth(passengerToken))
      .send({ target: "cancelled_by_passenger", reasonCode: "changed_mind" })
    expect(cancel.status).toBe(200)

    const passengerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger1.userId } })
    expect(passengerWallet.balance).toBe(150)
    const driverWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driverUserId } })
    expect(driverWallet.balance).toBe(50)
  })

  it("never charges a fee for a reason attributable to the driver, even with the policy enabled", async () => {
    const adminToken = await loginAs(fx.admin.phone)
    await putSetting(adminToken, "cancellation.penaltyEnabled", true)
    await putSetting(adminToken, "cancellation.freeWindowSec", 0)
    await prisma.wallet.update({ where: { userId: fx.passenger1.userId }, data: { balance: 200 } })
    const passengerToken = await loginAs(fx.passenger1.phone)

    const created = await request(app)
      .post("/v1/ride-requests")
      .set(auth(passengerToken))
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination, bookingMode: "quick_match", paymentMethod: "cash" })
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)
    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    const cancel = await request(app)
      .post(`/v1/rides/${rideId}/status`)
      .set(auth(passengerToken))
      .send({ target: "cancelled_by_passenger", reasonCode: "driver_too_far" })
    expect(cancel.status).toBe(200)

    const passengerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger1.userId } })
    expect(passengerWallet.balance).toBe(200) // untouched
  })

  it("charges nothing while the policy is disabled (the platform default)", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    await prisma.wallet.update({ where: { userId: fx.passenger1.userId }, data: { balance: 200 } })

    const created = await request(app)
      .post("/v1/ride-requests")
      .set(auth(passengerToken))
      .send({ cityId: fx.cityId, vehicleTypeId: fx.vehicleTypeIds.economy, pickup: samplePickup, destination: sampleDestination, bookingMode: "quick_match", paymentMethod: "cash" })
    const offerId = created.body.dispatch.offerId
    const dispatchedDriverId = created.body.dispatch.driverId
    const driverPhone = dispatchedDriverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)
    const accept = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accept.body.ride.id

    const cancel = await request(app)
      .post(`/v1/rides/${rideId}/status`)
      .set(auth(passengerToken))
      .send({ target: "cancelled_by_passenger", reasonCode: "changed_mind" })
    expect(cancel.status).toBe(200)

    const passengerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: fx.passenger1.userId } })
    expect(passengerWallet.balance).toBe(200)
  })
})
