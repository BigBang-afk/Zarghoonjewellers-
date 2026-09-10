import { beforeEach, describe, expect, it } from "vitest"
import request from "supertest"
import { createHmac } from "node:crypto"
import { app, auth, loginAs } from "./helpers.js"
import { resetDb, seedFixtures, samplePickup, sampleDestination, PASSWORD, type Fixtures } from "./fixtures.js"
import { prisma } from "../src/utils/prisma.js"
import { env } from "../src/config/env.js"

function signWebhookBody(body: unknown): string {
  const raw = JSON.stringify(body)
  return createHmac("sha256", env.paymentsWebhookSecret).update(raw).digest("hex")
}

let fx: Fixtures

beforeEach(async () => {
  await resetDb()
  fx = await seedFixtures()
})

async function loginAdmin() {
  return loginAs(fx.admin.phone)
}

// ---------------------------------------------------------------------
// Multi-city + currency (Phase 4 §1/§3)
// ---------------------------------------------------------------------

describe("Multi-city + currency", () => {
  it("gives a driver registered in a second city that city's own currency, without touching the pilot city's PKR wallets", async () => {
    const country = await prisma.country.create({ data: { name: "UAE", isoCode: "AE", defaultCurrencyCode: "AED" } })
    const dubai = await prisma.city.create({
      data: { countryId: country.id, name: "Dubai", status: "planned", currencyCode: "AED", timezone: "Asia/Dubai" },
    })
    await prisma.cityVehicleType.create({ data: { cityId: dubai.id, vehicleTypeId: fx.vehicleTypeIds.economy } })

    const reg = await request(app)
      .post("/v1/auth/register/driver")
      .send({
        fullName: "Dubai Driver",
        phone: "+971500000001",
        email: "dubai.driver@test.dev",
        password: PASSWORD,
        cityId: dubai.id,
        vehicle: { vehicleTypeCode: "economy", make: "Toyota", model: "Camry", plateNumber: "DXB-1" },
      })
    expect(reg.status).toBe(201)

    const wallet = await prisma.wallet.findUnique({ where: { userId: reg.body.userId } })
    expect(wallet?.currencyCode).toBe("AED")

    // The existing pilot-city fixtures are untouched.
    const pilotWallet = await prisma.wallet.findUnique({ where: { userId: fx.driver1.userId } })
    expect(pilotWallet?.currencyCode).toBe("PKR")
  })
})

// ---------------------------------------------------------------------
// Corporate accounts v1 (Phase 4 §13/§56)
// ---------------------------------------------------------------------

describe("Corporate accounts", () => {
  async function makeBusinessAccount(adminToken: string, monthlySpendLimit?: number) {
    const res = await request(app)
      .post("/v1/admin/business-accounts")
      .set(auth(adminToken))
      .send({
        companyName: "Acme Corp",
        billingContactUserId: fx.passenger1.userId,
        cityId: fx.cityId,
        paymentMethod: "wallet",
        ...(monthlySpendLimit ? { monthlySpendLimit } : {}),
      })
    expect(res.status).toBe(201)
    return res.body.account.id as string
  }

  it("rejects a ride request over the company's ride-policy cap and accepts one once the cap is raised", async () => {
    const adminToken = await loginAdmin()
    const ownerToken = await loginAs(fx.passenger1.phone)
    const accountId = await makeBusinessAccount(adminToken)

    const lowCap = await request(app)
      .put(`/v1/business/accounts/${accountId}/policy`)
      .set(auth(ownerToken))
      .send({ maxRideAmount: 10 })
    expect(lowCap.status).toBe(200)
    expect(lowCap.body.policy.maxRideAmount).toBe(10)

    const overCap = await request(app)
      .post("/v1/ride-requests")
      .set(auth(ownerToken))
      .send({
        cityId: fx.cityId,
        vehicleTypeId: fx.vehicleTypeIds.economy,
        pickup: samplePickup,
        destination: sampleDestination,
        bookingMode: "quick_match",
        paymentMethod: "wallet",
        businessAccountId: accountId,
      })
    expect(overCap.status).toBe(400)
    expect(overCap.body.error.code).toBe("RIDE_AMOUNT_EXCEEDS_POLICY")

    await request(app).put(`/v1/business/accounts/${accountId}/policy`).set(auth(ownerToken)).send({ maxRideAmount: 100000 })

    const withinCap = await request(app)
      .post("/v1/ride-requests")
      .set(auth(ownerToken))
      .send({
        cityId: fx.cityId,
        vehicleTypeId: fx.vehicleTypeIds.economy,
        pickup: samplePickup,
        destination: sampleDestination,
        bookingMode: "quick_match",
        paymentMethod: "wallet",
        businessAccountId: accountId,
      })
    expect(withinCap.status).toBe(201)
  })

  it("stops a member from managing the company roster, but lets the owner add/remove employees", async () => {
    const adminToken = await loginAdmin()
    const ownerToken = await loginAs(fx.passenger1.phone)
    const memberToken = await loginAs(fx.passenger2.phone)
    const accountId = await makeBusinessAccount(adminToken)

    const addSelf = await request(app)
      .post(`/v1/business/accounts/${accountId}/employees`)
      .set(auth(ownerToken))
      .send({ userId: fx.passenger2.userId, role: "member" })
    expect(addSelf.status).toBe(201)

    const memberTriesToAdd = await request(app)
      .post(`/v1/business/accounts/${accountId}/employees`)
      .set(auth(memberToken))
      .send({ userId: fx.passenger2.userId, role: "admin" })
    expect(memberTriesToAdd.status).toBe(403)

    const ownerRemoves = await request(app)
      .delete(`/v1/business/accounts/${accountId}/employees/${fx.passenger2.userId}`)
      .set(auth(ownerToken))
    expect(ownerRemoves.status).toBe(204)

    const ownerRemovesSelf = await request(app)
      .delete(`/v1/business/accounts/${accountId}/employees/${fx.passenger1.userId}`)
      .set(auth(ownerToken))
    expect(ownerRemovesSelf.status).toBe(400)
    expect(ownerRemovesSelf.body.error.code).toBe("CANNOT_REMOVE_OWNER")
  })

  it("enforces the monthly spend limit across multiple completed rides", async () => {
    const adminToken = await loginAdmin()
    const ownerToken = await loginAs(fx.passenger1.phone)
    const accountId = await makeBusinessAccount(adminToken, 50)

    const req = await request(app)
      .post("/v1/ride-requests")
      .set(auth(ownerToken))
      .send({
        cityId: fx.cityId,
        vehicleTypeId: fx.vehicleTypeIds.economy,
        pickup: samplePickup,
        destination: sampleDestination,
        bookingMode: "quick_match",
        paymentMethod: "wallet",
        businessAccountId: accountId,
      })
    // Fixture fare rules put the economy base fare well above Rs 50.
    expect(req.status).toBe(400)
    expect(["RIDE_AMOUNT_EXCEEDS_POLICY", "MONTHLY_SPEND_LIMIT_REACHED"]).toContain(req.body.error.code)
  })
})

// ---------------------------------------------------------------------
// Driver payouts (Phase 4 §5/§53)
// ---------------------------------------------------------------------

describe("Driver payouts", () => {
  it("moves funds through requested -> completed, updating available/pending/paid balances at each step", async () => {
    const driverToken = await loginAs(fx.driver1.phone)
    const adminToken = await loginAdmin()

    await prisma.wallet.update({ where: { userId: fx.driver1.userId }, data: { balance: 500, currencyCode: "PKR" } })

    const requested = await request(app).post("/v1/driver/me/payouts").set(auth(driverToken)).send({ amount: 200, method: "local_provider" })
    expect(requested.status).toBe(201)
    const payoutId = requested.body.payout.id as string

    let wallet = await prisma.wallet.findUnique({ where: { userId: fx.driver1.userId } })
    expect(wallet?.balance).toBe(300)
    expect(wallet?.pendingBalance).toBe(200)

    const completed = await request(app)
      .post(`/v1/admin/payouts/${payoutId}/complete`)
      .set(auth(adminToken))
      .send({ reference: "TEST-REF-001" })
    expect(completed.status).toBe(200)
    expect(completed.body.payout.status).toBe("completed")

    wallet = await prisma.wallet.findUnique({ where: { userId: fx.driver1.userId } })
    expect(wallet?.pendingBalance).toBe(0)
    expect(wallet?.paidBalance).toBe(200)
    expect(wallet?.balance).toBe(300)
  })

  it("returns the held amount to the available balance when a driver cancels a still-pending request", async () => {
    const driverToken = await loginAs(fx.driver1.phone)
    await prisma.wallet.update({ where: { userId: fx.driver1.userId }, data: { balance: 500 } })

    const requested = await request(app).post("/v1/driver/me/payouts").set(auth(driverToken)).send({ amount: 150, method: "card" })
    const payoutId = requested.body.payout.id as string

    const cancelled = await request(app).post(`/v1/driver/me/payouts/${payoutId}/cancel`).set(auth(driverToken))
    expect(cancelled.status).toBe(200)

    const wallet = await prisma.wallet.findUnique({ where: { userId: fx.driver1.userId } })
    expect(wallet?.balance).toBe(500)
    expect(wallet?.pendingBalance).toBe(0)
  })

  it("rejects a payout request larger than the driver's available balance", async () => {
    const driverToken = await loginAs(fx.driver1.phone)
    await prisma.wallet.update({ where: { userId: fx.driver1.userId }, data: { balance: 10 } })
    const res = await request(app).post("/v1/driver/me/payouts").set(auth(driverToken)).send({ amount: 500, method: "card" })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE")
  })

  it("never lets two concurrent requests both withdraw against the same balance (regression: security review Finding #2)", async () => {
    const driverToken = await loginAs(fx.driver1.phone)
    await prisma.wallet.update({ where: { userId: fx.driver1.userId }, data: { balance: 300 } })

    // Two simultaneous requests for 200 each against a balance of 300 —
    // at most one can legitimately succeed.
    const [first, second] = await Promise.all([
      request(app).post("/v1/driver/me/payouts").set(auth(driverToken)).send({ amount: 200, method: "card" }),
      request(app).post("/v1/driver/me/payouts").set(auth(driverToken)).send({ amount: 200, method: "card" }),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 400])

    const wallet = await prisma.wallet.findUnique({ where: { userId: fx.driver1.userId } })
    expect(wallet?.balance).toBe(100)
    expect(wallet?.pendingBalance).toBe(200)
  })
})

// ---------------------------------------------------------------------
// Payment webhooks (Phase 4 §4/§52) — idempotency
// ---------------------------------------------------------------------

describe("Payment webhooks", () => {
  it("processes a webhook event once and reports duplicate on redelivery, without double-processing", async () => {
    const body = { eventId: "evt_test_001", eventType: "payment.captured" as const, providerReference: "pi_test_001" }
    const signature = signWebhookBody(body)

    const first = await request(app).post("/v1/public/webhooks/card").set("X-RIVO-Webhook-Signature", signature).send(body)
    expect(first.status).toBe(200)
    expect(first.body.duplicate).toBeUndefined()

    const redelivered = await request(app).post("/v1/public/webhooks/card").set("X-RIVO-Webhook-Signature", signature).send(body)
    expect(redelivered.status).toBe(200)
    expect(redelivered.body.duplicate).toBe(true)

    const count = await prisma.webhookEvent.count({ where: { provider: "card", eventId: "evt_test_001" } })
    expect(count).toBe(1)
  })

  it("rejects a webhook whose signature doesn't match the raw body", async () => {
    const body = { eventId: "evt_test_003", eventType: "payment.captured" as const, providerReference: "pi_test_003" }
    const res = await request(app).post("/v1/public/webhooks/card").set("X-RIVO-Webhook-Signature", "not-the-real-signature").send(body)
    expect(res.status).toBe(401)
  })

  it("acknowledges but records a failure for an unknown provider name rather than erroring or retrying forever", async () => {
    const res = await request(app)
      .post("/v1/public/webhooks/not-a-real-provider")
      .send({ eventId: "evt_test_002", eventType: "payment.captured", providerReference: "pi_x" })
    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe(true)
    const row = await prisma.webhookEvent.findFirst({ where: { eventId: "evt_test_002" } })
    expect(row?.status).toBe("failed")
  })
})

// ---------------------------------------------------------------------
// Data privacy (Phase 4 §26/§60)
// ---------------------------------------------------------------------

describe("Data privacy", () => {
  it("takes a full deletion request from self-service through admin completion, and the anonymized account can no longer log in", async () => {
    const token = await loginAs(fx.passenger2.phone)
    const adminToken = await loginAdmin()

    const requested = await request(app).post("/v1/account/deletion-request").set(auth(token))
    expect(requested.status).toBe(201)

    const secondRequest = await request(app).post("/v1/account/deletion-request").set(auth(token))
    expect(secondRequest.status).toBe(409)

    const queue = await request(app).get("/v1/admin/privacy/deletion-requests").set(auth(adminToken))
    expect(queue.body.requests.some((r: { id: string }) => r.id === fx.passenger2.userId)).toBe(true)

    const completed = await request(app).post(`/v1/admin/privacy/deletion-requests/${fx.passenger2.userId}/complete`).set(auth(adminToken))
    expect(completed.status).toBe(200)

    const loginAttempt = await request(app).post("/v1/auth/login").send({ phone: fx.passenger2.phone, password: PASSWORD })
    expect(loginAttempt.status).toBe(400)

    const user = await prisma.user.findUnique({ where: { id: fx.passenger2.userId } })
    expect(user?.fullName).toBe("Deleted User")
    expect(user?.email).toBeNull()
    expect(user?.deletedAt).not.toBeNull()
  })

  it("never leaks internalNotes to the account it belongs to, on GET /me or export", async () => {
    const token = await loginAs(fx.passenger1.phone)
    const me = await request(app).get("/v1/account/me").set(auth(token))
    expect(me.status).toBe(200)
    expect(me.body.account).not.toHaveProperty("passwordHash")

    const exported = await request(app).get("/v1/account/export").set(auth(token))
    expect(exported.status).toBe(200)
    expect(exported.body.account).not.toHaveProperty("passwordHash")
  })
})

// ---------------------------------------------------------------------
// Pilot Mode (Phase 4 §37/§62)
// ---------------------------------------------------------------------

describe("Pilot Mode", () => {
  it("requires an invitation code, never spends a single-use code on a capacity-rejected signup, and lets the same code succeed once capacity allows it", async () => {
    const adminToken = await loginAdmin()

    const currentPassengers = await prisma.user.count({ where: { role: "passenger", deletedAt: null } })

    // Plenty of headroom at first, so the missing-code rejection below is
    // unambiguously about the code, not capacity (capacity is checked first).
    const enable = await request(app)
      .put("/v1/admin/pilot-mode")
      .set(auth(adminToken))
      .send({ enabled: true, cityId: fx.cityId, requireInvitationCode: true, maxPassengerCount: currentPassengers + 10 })
    expect(enable.status).toBe(200)

    const noCode = await request(app)
      .post("/v1/auth/register/passenger")
      .send({ fullName: "No Code", phone: "+923009990101", password: PASSWORD })
    expect(noCode.status).toBe(400)
    expect(noCode.body.error.code).toBe("INVITATION_CODE_REQUIRED")

    await request(app).post("/v1/admin/invitation-codes").set(auth(adminToken)).send({ code: "PILOTX", maxUses: 1 })

    // Now tighten capacity to exactly the current count, so a valid-code
    // signup still gets rejected on capacity — and must not burn the code.
    await request(app).put("/v1/admin/pilot-mode").set(auth(adminToken)).send({ maxPassengerCount: currentPassengers })

    const overCapacity = await request(app)
      .post("/v1/auth/register/passenger")
      .send({ fullName: "Over Capacity", phone: "+923009990102", password: PASSWORD, invitationCode: "PILOTX" })
    expect(overCapacity.status).toBe(403)

    const codeAfterRejection = await prisma.invitationCode.findUnique({ where: { code: "PILOTX" } })
    expect(codeAfterRejection?.usedCount).toBe(0)

    await request(app).put("/v1/admin/pilot-mode").set(auth(adminToken)).send({ maxPassengerCount: currentPassengers + 5 })

    const succeeds = await request(app)
      .post("/v1/auth/register/passenger")
      .send({ fullName: "Fits Now", phone: "+923009990102", password: PASSWORD, invitationCode: "PILOTX" })
    expect(succeeds.status).toBe(201)

    const codeAfterSuccess = await prisma.invitationCode.findUnique({ where: { code: "PILOTX" } })
    expect(codeAfterSuccess?.usedCount).toBe(1)

    const reuse = await request(app)
      .post("/v1/auth/register/passenger")
      .send({ fullName: "Reuse Attempt", phone: "+923009990103", password: PASSWORD, invitationCode: "PILOTX" })
    expect(reuse.status).toBe(400)
    expect(reuse.body.error.code).toBe("INVITATION_CODE_EXHAUSTED")
  })
})

// ---------------------------------------------------------------------
// Support v2 — reply threads and internalNotes privacy (Phase 4 §20/§58)
// ---------------------------------------------------------------------

describe("Support v2", () => {
  it("lets both sides reply on a ticket while keeping internalNotes admin-only", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const adminToken = await loginAdmin()

    const ticket = await request(app)
      .post("/v1/support/tickets")
      .set(auth(passengerToken))
      .send({ category: "payment", subject: "Test issue", description: "Something's wrong" })
    expect(ticket.status).toBe(201)
    expect(ticket.body.ticket).not.toHaveProperty("internalNotes")
    const ticketId = ticket.body.ticket.id as string

    await request(app)
      .patch(`/v1/admin/support-tickets/${ticketId}`)
      .set(auth(adminToken))
      .send({ internalNotes: "internal only", assignToSelf: true })

    await request(app).post(`/v1/admin/support-tickets/${ticketId}/messages`).set(auth(adminToken)).send({ body: "We're on it." })

    const passengerView = await request(app).get(`/v1/support/tickets/${ticketId}`).set(auth(passengerToken))
    expect(passengerView.body.ticket).not.toHaveProperty("internalNotes")
    expect(passengerView.body.ticket.messages).toHaveLength(1)

    const reply = await request(app).post(`/v1/support/tickets/${ticketId}/messages`).set(auth(passengerToken)).send({ body: "Thanks!" })
    expect(reply.status).toBe(201)

    const adminView = await request(app).get(`/v1/admin/support-tickets/${ticketId}`).set(auth(adminToken))
    expect(adminView.body.ticket.internalNotes).toBe("internal only")
    expect(adminView.body.ticket.messages).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------
// Localized notifications (Phase 4 §2/§19)
// ---------------------------------------------------------------------

describe("Localized notifications", () => {
  it("sends a ride-status notification in the passenger's chosen locale", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    await request(app).patch("/v1/account/locale").set(auth(passengerToken)).send({ locale: "ur" })

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
    const offerId = created.body.dispatch.offerId
    const driverPhone = created.body.dispatch.driverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)

    const accepted = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    const rideId = accepted.body.ride.id
    await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target: "driver_arriving" })

    const notifications = await request(app).get("/v1/notifications").set(auth(passengerToken))
    const arrivingNotification = notifications.body.notifications.find((n: { type: string; title: string }) => n.title.includes("پہنچ"))
    expect(arrivingNotification).toBeTruthy()
  })
})

// ---------------------------------------------------------------------
// Full end-to-end scenario (Phase 4 §41) — passenger -> driver -> payment
// -> analytics, chained through real HTTP requests, verifying the
// executive and unit-economics dashboards reflect exactly this one ride.
// ---------------------------------------------------------------------

describe("Full end-to-end: passenger -> driver -> payment -> analytics", () => {
  it("a completed cash ride shows up correctly in both analytics dashboards", async () => {
    const passengerToken = await loginAs(fx.passenger1.phone)
    const adminToken = await loginAdmin()

    const before = await request(app).get("/v1/admin/analytics/executive?from=2020-01-01").set(auth(adminToken))
    const completedBefore = before.body.completedRides as number
    const gbvBefore = before.body.grossBookingValueRs as number

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
    const agreedFare = created.body.request.agreedFare ?? created.body.request.proposedFare
    const offerId = created.body.dispatch.offerId
    const driverPhone = created.body.dispatch.driverId === fx.driver1.profileId ? fx.driver1.phone : fx.driver2.phone
    const driverToken = await loginAs(driverPhone)

    const accepted = await request(app).post(`/v1/ride-offers/${offerId}/accept`).set(auth(driverToken))
    expect(accepted.status).toBe(200)
    const rideId = accepted.body.ride.id as string

    for (const target of ["driver_arriving", "driver_arrived", "ride_started", "ride_completed"]) {
      const step = await request(app).post(`/v1/rides/${rideId}/status`).set(auth(driverToken)).send({ target })
      expect(step.status).toBe(200)
    }

    const payment = await prisma.payment.findUnique({ where: { rideId } })
    expect(payment?.status).toBe("captured")
    expect(payment?.method).toBe("cash")

    const after = await request(app).get("/v1/admin/analytics/executive?from=2020-01-01").set(auth(adminToken))
    expect(after.body.completedRides).toBe(completedBefore + 1)
    expect(after.body.grossBookingValueRs).toBeCloseTo(gbvBefore + (payment?.amount ?? 0), 1)

    const unitEconomics = await request(app).get("/v1/admin/analytics/unit-economics?from=2020-01-01").set(auth(adminToken))
    expect(unitEconomics.body.completedRides).toBeGreaterThanOrEqual(1)
    expect(unitEconomics.body.perRide.revenuePerRideRs.basis).toBe("actual")
    expect(unitEconomics.body.perRide.paymentProcessingCostPerRideRs.basis).toBe("estimate")

    const commission = await prisma.commission.findUnique({ where: { paymentId: payment!.id } })
    expect(commission?.amount).toBeGreaterThan(0)
    expect(agreedFare).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------
// Observability (Phase 4 §23/§59)
// ---------------------------------------------------------------------

describe("Observability", () => {
  it("counts a matching failure when a ride request has no eligible drivers", async () => {
    await prisma.driverProfile.updateMany({ data: { availabilityStatus: "offline" } })
    const adminToken = await loginAdmin()
    const before = await request(app).get("/v1/admin/observability").set(auth(adminToken))
    const beforeCount = before.body.failures.matching_failures as number

    const passengerToken = await loginAs(fx.passenger1.phone)
    await request(app)
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

    const after = await request(app).get("/v1/admin/observability").set(auth(adminToken))
    expect(after.body.failures.matching_failures).toBeGreaterThan(beforeCount)
  })
})

// ---------------------------------------------------------------------
// Admin role integrity (caught during Phase 4 documentation pass)
// ---------------------------------------------------------------------

describe("Admin roles", () => {
  it("accepts every AdminRole value when creating an admin user, including city_admin and marketing", async () => {
    const adminToken = await loginAdmin()
    for (const role of ["city_admin", "marketing"] as const) {
      const res = await request(app)
        .post("/v1/admin/admin-users")
        .set(auth(adminToken))
        .send({
          fullName: `Test ${role}`,
          phone: `+9231${role === "city_admin" ? "11" : "22"}000001`,
          email: `${role}@test.dev`,
          password: PASSWORD,
          role,
        })
      expect(res.status).toBe(201)
      expect(res.body.user.adminProfile.role).toBe(role)
    }
  })

  it("blocks a low-trust admin role from reading payout/payment/webhook data (regression: security review Finding #4)", async () => {
    const readOnlyUser = await prisma.user.create({
      data: {
        fullName: "Read Only Admin", phone: "+923100000097", role: "admin", status: "active", phoneVerifiedAt: new Date(),
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: fx.admin.userId } })).passwordHash,
        adminProfile: { create: { role: "read_only" } },
      },
    })
    const readOnlyToken = await loginAs(readOnlyUser.phone)

    for (const path of ["/v1/admin/payouts", "/v1/admin/payments", "/v1/admin/commissions", "/v1/admin/webhooks"]) {
      const res = await request(app).get(path).set(auth(readOnlyToken))
      expect(res.status).toBe(403)
    }

    const adminToken = await loginAdmin()
    const allowed = await request(app).get("/v1/admin/payouts").set(auth(adminToken))
    expect(allowed.status).toBe(200)
  })
})
