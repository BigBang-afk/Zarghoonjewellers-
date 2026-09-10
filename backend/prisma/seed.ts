/**
 * =====================================================================
 * RIVO — development seed data
 *
 * Everything created here is clearly-labeled SEED / DEMO data: fixed
 * test-account passwords (documented in the Phase 2 completion report),
 * a `[SEED]` marker in a few free-text fields, and phone numbers drawn
 * from a reserved +92300XXXXXXX block. Never run this against a
 * production database.
 *
 * Run with: npm run seed  (from backend/)
 * =====================================================================
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const PASSENGER_PASSWORD = "Passenger123!"
const DRIVER_PASSWORD = "Driver123!"
const ADMIN_PASSWORD = "Admin123!"

// Rough bounding box around Islamabad for scattering demo coordinates.
const ISB_CENTER = { lat: 33.6844, lng: 73.0479 }
function jitter(center: { lat: number; lng: number }, km = 6) {
  const dLat = (Math.random() - 0.5) * (km / 111)
  const dLng = (Math.random() - 0.5) * (km / (111 * Math.cos((center.lat * Math.PI) / 180)))
  return { lat: center.lat + dLat, lng: center.lng + dLng }
}

const PLACES = [
  "Centaurus Mall, F-8",
  "Faisal Mosque, Shah Faisal Ave",
  "Islamabad International Airport",
  "Blue Area, Jinnah Avenue",
  "G-9 Markaz",
  "F-10 Markaz",
  "F-7 Markaz, Jinnah Super",
  "Liaquat Bazar, Rawalpindi",
  "Bahria Town Phase 4",
  "Pakistan Monument, Shakarparian",
  "Rawal Lake View Point",
  "DHA Phase 2",
  "I-8 Markaz",
  "E-11 Markaz",
  "Saidpur Village",
]

function place() {
  const address = PLACES[Math.floor(Math.random() * PLACES.length)]
  return { address, ...jitter(ISB_CENTER) }
}

const PASSENGER_FIRST_NAMES = [
  "Ayesha", "Bilal", "Sara", "Usman", "Hina", "Danish", "Mahnoor", "Fahad", "Zara", "Hamza",
  "Bushra", "Hassan", "Mariam", "Kamran", "Sadia", "Omer", "Laiba", "Hassaan", "Anum", "Talha",
  "Rukhsar", "Adnan", "Fatima", "Shoaib", "Yusra", "Kamil", "Areeba", "Shahzaib", "Aliza", "Mustafa",
]
const PASSENGER_LAST_NAMES = [
  "Khan", "Ahmed", "Malik", "Tariq", "Shah", "Iqbal", "Ali", "Sheikh", "Baig", "Riaz",
  "Farooqi", "Chaudhry", "Bhatti", "Rana", "Qazi", "Dar", "Awan", "Gill", "Warraich", "Mirza",
]
/** 50 demo passenger names (Phase 3 §32 demo-mode scale) — deterministic so re-seeding is stable. */
const PASSENGER_NAMES = Array.from({ length: 50 }, (_, i) => `${PASSENGER_FIRST_NAMES[i % PASSENGER_FIRST_NAMES.length]} ${PASSENGER_LAST_NAMES[(i * 7) % PASSENGER_LAST_NAMES.length]}`)

const DRIVER_NAMES = [
  "Ahmed Raza", "Bilal Hussain", "Zainab Khan", "Kashif Mehmood", "Nadia Yousaf",
  "Imran Siddiqui", "Rabia Aslam", "Waqas Javed", "Sana Anwar", "Tariq Farooq",
  "Adeel Nasir", "Mehwish Aftab", "Junaid Akhtar", "Farah Deeba", "Shahid Latif",
  "Ayesha Noor", "Salman Qureshi", "Iqra Batool", "Noman Sultan", "Sidra Kamal",
  "Asad Ali", "Maryam Fayyaz", "Rizwan Butt", "Komal Shahzad", "Ali Hassan",
  "Sobia Yasin", "Faisal Chaudhry", "Amna Rasheed", "Zeeshan Abbas", "Nida Parveen",
]

const VEHICLE_TYPES = [
  { code: "bike", name: "Bike", capacity: 1, sortOrder: 1, base: 60, perKm: 15, perMin: 2, min: 100, max: 800 },
  { code: "rickshaw", name: "Rickshaw", capacity: 3, sortOrder: 2, base: 90, perKm: 20, perMin: 3, min: 150, max: 1200 },
  { code: "economy", name: "Economy", capacity: 4, sortOrder: 3, base: 150, perKm: 32, perMin: 5, min: 250, max: 3000 },
  { code: "standard", name: "Standard", capacity: 4, sortOrder: 4, base: 200, perKm: 42, perMin: 6, min: 320, max: 4000 },
  { code: "premium", name: "Premium", capacity: 4, sortOrder: 5, base: 350, perKm: 65, perMin: 9, min: 550, max: 6000 },
]

const CAR_MODELS: [string, string][] = [
  ["Toyota", "Corolla"], ["Honda", "City"], ["Suzuki", "Cultus"], ["Suzuki", "Alto"],
  ["Toyota", "Yaris"], ["Honda", "Civic"], ["Kia", "Sportage"], ["Hyundai", "Elantra"],
]
const COLORS = ["White", "Silver", "Black", "Blue", "Grey", "Red"]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function round2(n: number) {
  return Math.round(n * 100) / 100
}

async function wipe() {
  // Reverse-dependency order so this script is safely re-runnable against
  // an existing dev database.
  const tables = [
    "auditLog", "adminUser",
    "review", "rating", "message", "notification",
    "transaction", "commission", "payment",
    "rideStatusHistory", "rideLocation", "safetyEvent", "dispute", "supportTicket", "ride",
    "counterOffer", "rideOffer", "rideRequest",
    "promoRedemption", "favoriteDriver",
    "driverIncentiveProgress", "incentiveReward",
    "scheduledRide",
    "driverOnlineSession",
    "payoutRequest",
    "vehicleDocument", "vehicle", "driverDocument", "driverProfile",
    "wallet", "passengerProfile", "location",
    "businessEmployee", "businessAccount",
    "referral", "referralCode",
    "riskEvent", "riskScore", "notificationPreference", "userBlock",
    "incentiveCampaign",
    "contentItem", "notificationTemplate", "waitlistEntry", "invitationCode", "webhookEvent",
    "refreshToken", "otpCode", "user",
    "fareRule", "cityVehicleType", "promotion", "serviceZone", "city", "country",
    "vehicleType", "platformSetting",
  ] as const
  for (const t of tables) {
    // @ts-expect-error dynamic model access is intentional for a generic wipe
    await prisma[t].deleteMany()
  }
}

async function main() {
  console.log("[SEED] Wiping existing data...")
  await wipe()

  console.log("[SEED] Creating country, city, zones, vehicle types...")
  const country = await prisma.country.create({
    data: { name: "Pakistan", isoCode: "PK", defaultCurrencyCode: "PKR" },
  })
  const city = await prisma.city.create({
    data: {
      countryId: country.id, name: "Islamabad", status: "live", currencyCode: "PKR", timezone: "Asia/Karachi",
      centerLat: ISB_CENTER.lat, centerLng: ISB_CENTER.lng,
      paymentMethods: JSON.stringify(["cash", "card", "wallet"]),
      driverRequirements: JSON.stringify({ minAge: 21, minLicenseYears: 1, requiredDocs: ["national_id", "driving_license", "vehicle_registration", "insurance"] }),
    },
  })

  // A second city configured but never launched (Phase 4 §1: the
  // architecture must be multi-city-capable while the pilot itself stays
  // focused on one city). Different country/currency/vehicle mix/driver
  // requirements on purpose, to prove nothing is hard-coded to Pakistan/PKR.
  console.log("[SEED] Creating a second (not-yet-launched) city to prove multi-city architecture...")
  const uaeCountry = await prisma.country.create({ data: { name: "United Arab Emirates", isoCode: "AE", defaultCurrencyCode: "AED" } })
  const dubai = await prisma.city.create({
    data: {
      countryId: uaeCountry.id, name: "Dubai", status: "planned", currencyCode: "AED", timezone: "Asia/Dubai",
      centerLat: 25.2048, centerLng: 55.2708,
      paymentMethods: JSON.stringify(["card", "wallet"]),
      driverRequirements: JSON.stringify({ minAge: 25, minLicenseYears: 2, requiredDocs: ["national_id", "driving_license", "vehicle_registration", "insurance", "route_permit"] }),
    },
  })

  const zones = await Promise.all(
    ["Blue Area & Diplomatic Enclave", "F-Sectors", "G-Sectors & I-Sectors"].map((name) =>
      prisma.serviceZone.create({
        data: { cityId: city.id, name, boundaryGeoJson: JSON.stringify({ type: "Polygon", coordinates: [] }) },
      }),
    ),
  )
  void zones

  const vehicleTypes = await Promise.all(
    VEHICLE_TYPES.map((vt) =>
      prisma.vehicleType.create({ data: { code: vt.code, name: vt.name, capacity: vt.capacity, sortOrder: vt.sortOrder } }),
    ),
  )
  await Promise.all(vehicleTypes.map((vt) => prisma.cityVehicleType.create({ data: { cityId: city.id, vehicleTypeId: vt.id } })))

  console.log("[SEED] Creating fare rules (admin-configurable pricing)...")
  await Promise.all(
    vehicleTypes.map((vt, i) => {
      const cfg = VEHICLE_TYPES[i]
      return prisma.fareRule.create({
        data: {
          cityId: city.id,
          vehicleTypeId: vt.id,
          baseFare: cfg.base,
          perKmRate: cfg.perKm,
          perMinRate: cfg.perMin,
          minimumFare: cfg.min,
          maximumFare: cfg.max,
          commissionRate: 0.15,
          surgeMinMultiplier: 1.0,
          surgeMaxMultiplier: 2.0,
        },
      })
    }),
  )

  // Dubai only offers Economy/Standard/Premium (no bike/rickshaw), at
  // AED-appropriate fare magnitudes and a different commission — proving
  // per-city vehicle mix and pricing are actually independent, not shared
  // global constants (Phase 4 §1).
  const dubaiVehicleCodes = ["economy", "standard", "premium"] as const
  const dubaiFareCfg: Record<(typeof dubaiVehicleCodes)[number], { base: number; perKm: number; perMin: number; min: number; max: number }> = {
    economy: { base: 5, perKm: 1.8, perMin: 0.3, min: 12, max: 250 },
    standard: { base: 8, perKm: 2.4, perMin: 0.4, min: 18, max: 350 },
    premium: { base: 15, perKm: 3.5, perMin: 0.6, min: 30, max: 600 },
  }
  for (const code of dubaiVehicleCodes) {
    const vt = vehicleTypes.find((v) => v.code === code)!
    await prisma.cityVehicleType.create({ data: { cityId: dubai.id, vehicleTypeId: vt.id } })
    const cfg = dubaiFareCfg[code]
    await prisma.fareRule.create({
      data: {
        cityId: dubai.id, vehicleTypeId: vt.id, baseFare: cfg.base, perKmRate: cfg.perKm, perMinRate: cfg.perMin,
        minimumFare: cfg.min, maximumFare: cfg.max, commissionRate: 0.2, surgeMinMultiplier: 1.0, surgeMaxMultiplier: 2.0,
      },
    })
  }

  console.log("[SEED] Writing default platform settings...")
  const settingsRows: [string, unknown, string][] = [
    ["matching.initialRadiusKm", 5, "Initial driver-search radius for a new ride request"],
    ["matching.radiusExpansionStepsKm", [5, 8, 12, 20], "Radius (km) steps tried if too few drivers are found"],
    ["matching.maxRadiusKm", 20, "Hard ceiling on search radius expansion"],
    ["matching.quickMatchDispatchTimeoutSec", 20, "How long a Quick Match candidate has to accept before escalating"],
    ["matching.competitiveOfferMaxDrivers", 8, "Max drivers notified per Competitive Offer broadcast"],
    ["negotiation.offerExpirySec", 90, "How long a Competitive Offer stays open for a driver to respond"],
    ["negotiation.counterOfferExpirySec", 90, "How long a driver's counter-offer stays open for the passenger"],
    ["negotiation.requestExpiryMinutes", 5, "Top-level TTL on an unresolved ride request"],
    ["fare.defaultCommissionRate", 0.15, "Fallback commission rate if a route has no FareRule (should not normally happen)"],
    ["fare.demandMultiplierMin", 1.0, "Lower bound of the live demand surge multiplier"],
    ["fare.demandMultiplierMax", 2.5, "Upper bound of the live demand surge multiplier"],
  ]
  await Promise.all(
    settingsRows.map(([key, value, description]) =>
      prisma.platformSetting.create({ data: { key, value: JSON.stringify(value), description } }),
    ),
  )

  console.log("[SEED] Creating admin accounts...")
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  const superAdminUser = await prisma.user.create({
    data: {
      fullName: "RIVO Super Admin", phone: "+923000000001", email: "superadmin@rivo.dev",
      passwordHash: adminPasswordHash, role: "admin", status: "active", phoneVerifiedAt: new Date(),
      adminProfile: { create: { role: "super_admin" } },
    },
  })
  const opsAdminUser = await prisma.user.create({
    data: {
      fullName: "RIVO Ops Manager", phone: "+923000000002", email: "ops@rivo.dev",
      passwordHash: adminPasswordHash, role: "admin", status: "active", phoneVerifiedAt: new Date(),
      adminProfile: { create: { role: "ops_manager", cityScope: city.id } },
    },
  })
  void opsAdminUser

  console.log(`[SEED] Creating ${PASSENGER_NAMES.length} passengers...`)
  const passengerPasswordHash = await bcrypt.hash(PASSENGER_PASSWORD, 10)
  const passengers = []
  for (let i = 0; i < PASSENGER_NAMES.length; i++) {
    // A handful of passengers start with a wallet balance so the wallet UI has something to show on day one.
    const startingBalance = i % 7 === 0 ? round2(200 + Math.random() * 800) : 0
    const user = await prisma.user.create({
      data: {
        fullName: PASSENGER_NAMES[i],
        phone: `+92300100${String(i + 1).padStart(4, "0")}`,
        email: `passenger${i + 1}@rivo.dev`,
        passwordHash: passengerPasswordHash,
        role: "passenger",
        status: "active",
        primaryCityId: city.id,
        phoneVerifiedAt: new Date(),
        passengerProfile: { create: {} },
        wallet: { create: { balance: startingBalance, currencyCode: "PKR" } },
      },
      include: { passengerProfile: true },
    })
    if (startingBalance > 0) {
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })
      await prisma.transaction.create({
        data: { walletId: wallet.id, type: "wallet_topup", amount: startingBalance, balanceAfter: startingBalance, description: "[SEED] Initial wallet top-up" },
      })
    }
    await prisma.referralCode.create({ data: { userId: user.id, code: `PSGR${String(i + 1).padStart(3, "0")}` } })
    passengers.push(user)
  }

  console.log("[SEED] Creating 30 drivers + vehicles + documents...")
  const driverPasswordHash = await bcrypt.hash(DRIVER_PASSWORD, 10)
  const drivers: Array<Awaited<ReturnType<typeof prisma.user.create>> & { driverProfile: NonNullable<Awaited<ReturnType<typeof prisma.driverProfile.findFirst>>> }> = []

  for (let i = 0; i < DRIVER_NAMES.length; i++) {
    const vt = vehicleTypes[i % vehicleTypes.length]
    const [make, model] = pick(CAR_MODELS)
    const isPendingVerification = i >= 25 // last 5 drivers await verification (populates the queue)
    const online = !isPendingVerification && i % 3 !== 0 // ~2/3 of approved drivers online
    const pos = jitter(ISB_CENTER, 8)

    const user = await prisma.user.create({
      data: {
        fullName: DRIVER_NAMES[i],
        phone: `+92300200${String(i + 1).padStart(4, "0")}`,
        email: `driver${i + 1}@rivo.dev`,
        passwordHash: driverPasswordHash,
        role: "driver",
        status: "active",
        primaryCityId: city.id,
        phoneVerifiedAt: new Date(),
        wallet: { create: { balance: 0, currencyCode: "PKR" } },
        driverProfile: {
          create: {
            cityId: city.id,
            verificationStatus: isPendingVerification ? "pending" : "approved",
            availabilityStatus: online ? "online" : "offline",
            licenseNumber: `LHR-${100000 + i}`,
            licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
            ratingAvg: round2(4.5 + Math.random() * 0.5),
            ratingCount: 20 + Math.floor(Math.random() * 200),
            acceptanceRate: round2(75 + Math.random() * 25),
            cancellationRate: round2(Math.random() * 5),
            lastLat: online ? pos.lat : null,
            lastLng: online ? pos.lng : null,
            lastLocationAt: online ? new Date() : null,
            vehicles: {
              create: {
                vehicleTypeId: vt.id,
                make,
                model,
                year: 2018 + (i % 6),
                color: pick(COLORS),
                plateNumber: `ICT-${1000 + i}`,
                status: isPendingVerification ? "pending" : "active",
                documents: {
                  create: [
                    { docType: "vehicle_registration", fileUrl: "https://example.com/seed/reg.pdf", status: isPendingVerification ? "pending" : "approved" },
                    { docType: "insurance", fileUrl: "https://example.com/seed/insurance.pdf", status: isPendingVerification ? "pending" : "approved" },
                  ],
                },
              },
            },
            documents: {
              create: [
                { docType: "national_id", fileUrl: "https://example.com/seed/cnic.jpg", status: isPendingVerification ? "pending" : "approved" },
                { docType: "driving_license", fileUrl: "https://example.com/seed/license.jpg", status: isPendingVerification ? "pending" : "approved" },
              ],
            },
          },
        },
      },
      include: { driverProfile: { include: { vehicles: true } } },
    })
    await prisma.referralCode.create({ data: { userId: user.id, code: `DRVR${String(i + 1).padStart(3, "0")}` } })

    // A few online-session rows spread over the last two weeks so the
    // earnings-per-hour calculation has real elapsed time to divide by.
    if (!isPendingVerification) {
      const sessionCount = 3 + Math.floor(Math.random() * 5)
      for (let s = 0; s < sessionCount; s++) {
        const daysAgo = Math.floor(Math.random() * 14)
        const startHour = 8 + Math.floor(Math.random() * 10)
        const startedAt = new Date(Date.now() - daysAgo * 86_400_000)
        startedAt.setHours(startHour, 0, 0, 0)
        const durationHours = 2 + Math.random() * 5
        const endedAt = new Date(startedAt.getTime() + durationHours * 3_600_000)
        await prisma.driverOnlineSession.create({ data: { driverId: user.driverProfile!.id, startedAt, endedAt } })
      }
      // The currently-online drivers have one still-open session.
      if (online) {
        await prisma.driverOnlineSession.create({ data: { driverId: user.driverProfile!.id, startedAt: new Date(Date.now() - 45 * 60_000) } })
      }
    }

    drivers.push(user as never)
  }

  const driverProfiles = await prisma.driverProfile.findMany({ include: { vehicles: true, user: true } })
  const onlineDrivers = driverProfiles.filter((d) => d.availabilityStatus === "online")

  async function createLocation(userId: string, p: { address: string; lat: number; lng: number }) {
    return prisma.location.create({ data: { userId, ...p } })
  }

  // ---------------------------------------------------------------------
  // Historical rides (110: ~90 completed, ~20 cancelled) spread over the
  // last 45 days — full lifecycle incl. payment, commission, wallet
  // transaction, ratings, and a realistic cancellation rate for the
  // analytics/cohort endpoints to have something to compute (Phase 3 §32).
  // ---------------------------------------------------------------------
  const HISTORICAL_RIDE_COUNT = 110
  console.log(`[SEED] Creating ${HISTORICAL_RIDE_COUNT} historical rides with payments, ratings, and cancellations...`)
  const favoriteCandidates: { passengerId: string; passengerUserId: string; driverId: string }[] = []
  for (let i = 0; i < HISTORICAL_RIDE_COUNT; i++) {
    const passenger = passengers[i % passengers.length]
    const driver = pick(driverProfiles.filter((d) => d.verificationStatus === "approved"))
    const vehicle = driver.vehicles[0]
    const pickupPlace = place()
    const destPlace = place()
    const pickup = await createLocation(passenger.id, pickupPlace)
    const destination = await createLocation(passenger.id, destPlace)
    const vt = VEHICLE_TYPES.find((v) => v.code === vehicleTypes.find((x) => x.id === vehicle.vehicleTypeId)?.code)!
    const distanceKm = round2(3 + Math.random() * 15)
    const fare = round2(vt.base + distanceKm * vt.perKm)
    const bookingMode = i % 2 === 0 ? "quick_match" : "competitive_offer"
    const isCancelled = i % 6 === 0 // ~17% cancellation rate — realistic demo signal, not a real-world benchmark
    const cancelledByDriver = isCancelled && i % 2 === 0

    // Spread across the last 45 days instead of the last few hours, so
    // daily/weekly earnings charts and cohort windows have real spread.
    const daysAgo = Math.floor(Math.random() * 45)
    const acceptedAt = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(Math.random() * 12) * 3_600_000)

    const request = await prisma.rideRequest.create({
      data: {
        passengerId: passenger.passengerProfile!.id,
        cityId: city.id,
        vehicleTypeId: vehicle.vehicleTypeId,
        pickupLocationId: pickup.id,
        destinationLocationId: destination.id,
        bookingMode,
        suggestedFare: fare,
        proposedFare: fare,
        distanceKm,
        estDurationMin: Math.round(distanceKm * 2.2),
        status: "matched",
        createdAt: acceptedAt,
        expiresAt: new Date(acceptedAt.getTime() + 3600_000),
      },
    })
    const offer = await prisma.rideOffer.create({
      data: {
        rideRequestId: request.id, driverId: driver.id, vehicleId: vehicle.id,
        offerPrice: fare, etaMin: 5, distanceKm, status: "accepted",
        createdAt: acceptedAt,
        expiresAt: new Date(acceptedAt.getTime() + 600_000),
      },
    })

    if (isCancelled) {
      const cancelledAt = new Date(acceptedAt.getTime() + (2 + Math.random() * 6) * 60_000)
      await prisma.ride.create({
        data: {
          rideRequestId: request.id, rideOfferId: offer.id,
          passengerId: passenger.passengerProfile!.id, driverId: driver.id, vehicleId: vehicle.id,
          pickupLocationId: pickup.id, destinationLocationId: destination.id,
          agreedFare: fare, distanceKm,
          status: cancelledByDriver ? "cancelled_by_driver" : "cancelled_by_passenger",
          acceptedAt, cancelledAt, cancellationReason: "[SEED] Demo cancellation",
          createdAt: acceptedAt,
          shareToken: `seed-cancelled-${i}-${Date.now()}`,
          statusHistory: { create: [{ status: "driver_selected", changedAt: acceptedAt }, { status: cancelledByDriver ? "cancelled_by_driver" : "cancelled_by_passenger", changedAt: cancelledAt }] },
        },
      })
      await prisma.driverProfile.update({ where: { id: driver.id }, data: { cancelledRides: { increment: cancelledByDriver ? 1 : 0 } } })
      await prisma.passengerProfile.update({ where: { id: passenger.passengerProfile!.id }, data: { cancelledRides: { increment: cancelledByDriver ? 0 : 1 } } })
      continue
    }

    const startedAt = new Date(acceptedAt.getTime() + 6 * 60_000)
    const durationMin = Math.round(distanceKm * 2.2)
    const completedAt = new Date(startedAt.getTime() + durationMin * 60_000)

    const ride = await prisma.ride.create({
      data: {
        rideRequestId: request.id, rideOfferId: offer.id,
        passengerId: passenger.passengerProfile!.id, driverId: driver.id, vehicleId: vehicle.id,
        pickupLocationId: pickup.id, destinationLocationId: destination.id,
        agreedFare: fare, finalFare: fare, distanceKm, durationMin,
        status: "ride_completed",
        acceptedAt, arrivedAt: new Date(acceptedAt.getTime() + 4 * 60_000), startedAt, completedAt,
        createdAt: acceptedAt,
        shareToken: `seed-share-${i}-${Date.now()}`,
        statusHistory: {
          create: [
            { status: "driver_selected", changedAt: acceptedAt },
            { status: "driver_arrived", changedAt: new Date(acceptedAt.getTime() + 4 * 60_000) },
            { status: "ride_started", changedAt: startedAt },
            { status: "ride_completed", changedAt: completedAt },
          ],
        },
      },
    })

    const commissionAmount = round2(fare * 0.15)
    const driverPayout = round2(fare - commissionAmount)
    const payment = await prisma.payment.create({
      data: {
        rideId: ride.id, method: i % 4 === 0 ? "card" : "cash", status: "captured",
        amount: fare, currencyCode: "PKR", providerReference: `seed_pay_${i}`, capturedAt: completedAt, createdAt: completedAt,
      },
    })
    await prisma.commission.create({ data: { paymentId: payment.id, rate: 0.15, amount: commissionAmount } })

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.userId } })
    const newBalance = round2(wallet.balance + driverPayout)
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } })
    await prisma.transaction.create({
      data: { walletId: wallet.id, paymentId: payment.id, type: "ride_payout", amount: driverPayout, balanceAfter: newBalance, description: `[SEED] Ride ${ride.id.slice(0, 8)} payout`, createdAt: completedAt },
    })

    await prisma.driverProfile.update({ where: { id: driver.id }, data: { completedRides: { increment: 1 } } })
    await prisma.passengerProfile.update({ where: { id: passenger.passengerProfile!.id }, data: { completedRides: { increment: 1 } } })
    favoriteCandidates.push({ passengerId: passenger.passengerProfile!.id, passengerUserId: passenger.id, driverId: driver.id })

    // Passenger rates driver on most rides; driver rates passenger sometimes.
    const score = 4 + Math.round(Math.random())
    await prisma.rating.create({
      data: { rideId: ride.id, raterId: passenger.id, rateeId: driver.userId, score, createdAt: completedAt,
        review: i % 3 === 0 ? { create: { comment: "[SEED] Great ride, smooth and on time." } } : undefined },
    })
    if (i % 2 === 0) {
      await prisma.rating.create({ data: { rideId: ride.id, raterId: driver.userId, rateeId: passenger.id, score: 5, createdAt: completedAt } })
    }
  }

  // Recompute cancellationRate/ratingAvg roll-ups the way the app's own
  // rating/status services would, since this loop bypassed those services.
  for (const d of await prisma.driverProfile.findMany()) {
    const total = d.completedRides + d.cancelledRides
    if (total > 0) await prisma.driverProfile.update({ where: { id: d.id }, data: { cancellationRate: round2((d.cancelledRides / total) * 100) } })
  }

  // ---------------------------------------------------------------------
  // Active rides (4) — in various in-progress statuses
  // ---------------------------------------------------------------------
  console.log("[SEED] Creating active rides...")
  const activeStatuses = ["driver_selected", "driver_arriving", "driver_arrived", "ride_started"] as const
  const approvedOnlineDrivers = onlineDrivers.filter((d) => d.verificationStatus === "approved").slice(0, 4)
  for (let i = 0; i < approvedOnlineDrivers.length; i++) {
    const driver = approvedOnlineDrivers[i]
    const vehicle = driver.vehicles[0]
    const passenger = passengers[(i + 3) % passengers.length]
    const pickup = await createLocation(passenger.id, place())
    const destination = await createLocation(passenger.id, place())
    const distanceKm = round2(2 + Math.random() * 10)
    const fare = round2(300 + Math.random() * 400)

    const request = await prisma.rideRequest.create({
      data: {
        passengerId: passenger.passengerProfile!.id, cityId: city.id, vehicleTypeId: vehicle.vehicleTypeId,
        pickupLocationId: pickup.id, destinationLocationId: destination.id,
        bookingMode: "quick_match", suggestedFare: fare, proposedFare: fare, distanceKm,
        estDurationMin: Math.round(distanceKm * 2.2), status: "matched", expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const offer = await prisma.rideOffer.create({
      data: { rideRequestId: request.id, driverId: driver.id, vehicleId: vehicle.id, offerPrice: fare, etaMin: 6, distanceKm, status: "accepted", expiresAt: new Date(Date.now() + 3600_000) },
    })
    await prisma.ride.create({
      data: {
        rideRequestId: request.id, rideOfferId: offer.id,
        passengerId: passenger.passengerProfile!.id, driverId: driver.id, vehicleId: vehicle.id,
        pickupLocationId: pickup.id, destinationLocationId: destination.id,
        agreedFare: fare, distanceKm, status: activeStatuses[i],
        shareToken: `seed-active-${i}-${Date.now()}`,
        statusHistory: { create: { status: activeStatuses[i] } },
      },
    })
    await prisma.driverProfile.update({ where: { id: driver.id }, data: { availabilityStatus: "on_trip" } })
  }

  // ---------------------------------------------------------------------
  // Pending ride requests (5) — some quick_match (single dispatched
  // offer), some competitive_offer (several offers incl. a counter).
  // ---------------------------------------------------------------------
  console.log("[SEED] Creating pending ride requests with live offers...")
  const remainingOnline = onlineDrivers.filter((d) => !approvedOnlineDrivers.includes(d))
  for (let i = 0; i < 5; i++) {
    const passenger = passengers[(i + 6) % passengers.length]
    const pickup = await createLocation(passenger.id, place())
    const destination = await createLocation(passenger.id, place())
    const distanceKm = round2(2 + Math.random() * 12)
    const suggestedFare = round2(250 + Math.random() * 350)
    const competitive = i % 2 === 1
    const vt = vehicleTypes[i % vehicleTypes.length]

    const request = await prisma.rideRequest.create({
      data: {
        passengerId: passenger.passengerProfile!.id, cityId: city.id, vehicleTypeId: vt.id,
        pickupLocationId: pickup.id, destinationLocationId: destination.id,
        bookingMode: competitive ? "competitive_offer" : "quick_match",
        suggestedFare, proposedFare: competitive ? round2(suggestedFare * 0.92) : suggestedFare,
        distanceKm, estDurationMin: Math.round(distanceKm * 2.2),
        status: competitive ? "offers_open" : "searching",
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    })

    const candidateDrivers = remainingOnline.filter((d) => d.vehicles.some((v) => v.vehicleTypeId === vt.id)).slice(0, competitive ? 3 : 1)
    for (let j = 0; j < candidateDrivers.length; j++) {
      const d = candidateDrivers[j]
      const vehicle = d.vehicles.find((v) => v.vehicleTypeId === vt.id)!
      const offer = await prisma.rideOffer.create({
        data: {
          rideRequestId: request.id, driverId: d.id, vehicleId: vehicle.id,
          offerPrice: request.proposedFare, etaMin: 4 + j * 2, distanceKm: round2(1 + Math.random() * 3),
          status: j === 0 && competitive ? "accepted" : "pending",
          expiresAt: new Date(Date.now() + 90_000),
        },
      })
      if (competitive && j === 1) {
        await prisma.counterOffer.create({
          data: { rideOfferId: offer.id, counterPrice: round2(request.proposedFare * 1.08), status: "pending", expiresAt: new Date(Date.now() + 90_000) },
        })
      }
    }
  }

  // A couple of closed-out requests for history variety.
  const expiredPassenger = passengers[0]
  const expPickup = await createLocation(expiredPassenger.id, place())
  const expDest = await createLocation(expiredPassenger.id, place())
  await prisma.rideRequest.create({
    data: {
      passengerId: expiredPassenger.passengerProfile!.id, cityId: city.id, vehicleTypeId: vehicleTypes[0].id,
      pickupLocationId: expPickup.id, destinationLocationId: expDest.id, bookingMode: "quick_match",
      suggestedFare: 200, proposedFare: 200, status: "expired", expiresAt: new Date(Date.now() - 60_000),
    },
  })

  // ---------------------------------------------------------------------
  // Support tickets, a dispute, a safety event, a promotion
  // ---------------------------------------------------------------------
  console.log("[SEED] Creating support tickets, dispute, safety event, promotion...")
  await prisma.supportTicket.create({
    data: { userId: passengers[1].id, subject: "[SEED] Charged twice for one ride", status: "open", priority: "high" },
  })
  await prisma.supportTicket.create({
    data: { userId: drivers[0].id, subject: "[SEED] Unable to update vehicle documents", status: "in_progress", priority: "medium", assignedAdminId: superAdminUser.id },
  })

  const disputedRide = await prisma.ride.findFirst({ where: { status: "ride_completed" } })
  if (disputedRide) {
    await prisma.dispute.create({
      data: { rideId: disputedRide.id, raisedById: passengers[2].id, reason: "[SEED] Driver took a longer route than necessary.", status: "open" },
    })
  }

  await prisma.safetyEvent.create({
    data: { userId: passengers[3].id, type: "report_filed", severity: "medium", details: JSON.stringify({ note: "[SEED] Demo safety report for admin queue" }) },
  })

  await prisma.promotion.create({
    data: { code: "RIVOFIRST", description: "[SEED] 20% off your first ride", discountType: "percentage", discountValue: 20, maxDiscount: 200, cityId: city.id, usageLimit: 1000, createdById: superAdminUser.id },
  })
  await prisma.promotion.create({
    data: { code: "RIVO100", description: "[SEED] Rs 100 off", discountType: "flat", discountValue: 100, cityId: city.id, createdById: superAdminUser.id },
  })

  // A couple more tickets/disputes across statuses and categories, so the
  // admin support/dispute queues show variety rather than a single row.
  await prisma.supportTicket.create({
    data: { userId: passengers[4].id, category: "pricing", subject: "[SEED] Fare seemed higher than the estimate", status: "waiting", priority: "low" },
  })
  await prisma.supportTicket.create({
    data: { userId: drivers[5].id, category: "payment", subject: "[SEED] Missing payout for last week", status: "resolved", priority: "high", assignedAdminId: superAdminUser.id, resolvedAt: new Date() },
  })
  const secondDisputedRide = await prisma.ride.findFirst({ where: { status: "ride_completed" }, skip: 1 })
  if (secondDisputedRide) {
    await prisma.dispute.create({
      data: {
        rideId: secondDisputedRide.id, raisedById: passengers[5].id, reason: "[SEED] Requesting refund for cancelled portion",
        status: "resolved", decision: "refund_passenger", resolution: "[SEED] Verified and refunded.", resolvedById: superAdminUser.id, resolvedAt: new Date(),
      },
    })
  }

  // ---------------------------------------------------------------------
  // Favorite drivers — a handful of passengers who actually rode with
  // that driver (Phase 3 §12: never fabricated, always backed by a real
  // completed ride).
  // ---------------------------------------------------------------------
  console.log("[SEED] Creating favorite drivers, referrals, incentives, scheduled rides, business account, risk signals...")
  const seenFavoritePairs = new Set<string>()
  let favoritesCreated = 0
  for (const c of favoriteCandidates) {
    if (favoritesCreated >= 6) break
    const key = `${c.passengerId}:${c.driverId}`
    if (seenFavoritePairs.has(key)) continue
    seenFavoritePairs.add(key)
    await prisma.favoriteDriver.create({ data: { passengerId: c.passengerId, driverId: c.driverId } })
    favoritesCreated++
  }

  // ---------------------------------------------------------------------
  // Referrals — one pending (just applied, hasn't ridden yet) and one
  // fully rewarded (mirrors what referralService.qualifyReferralOnFirstRide
  // actually writes, so the demo data is consistent with real writes).
  // ---------------------------------------------------------------------
  const referrerCode = await prisma.referralCode.findUniqueOrThrow({ where: { userId: passengers[20].id } })
  await prisma.referral.create({
    data: { referrerUserId: passengers[20].id, referredUserId: passengers[21].id, code: referrerCode.code, status: "pending" },
  })
  const rewardedReferrerCode = await prisma.referralCode.findUniqueOrThrow({ where: { userId: passengers[22].id } })
  await prisma.referral.create({
    data: {
      referrerUserId: passengers[22].id, referredUserId: passengers[23].id, code: rewardedReferrerCode.code, status: "rewarded",
      qualifyingAction: "first_ride_completed", qualifiedAt: new Date(), rewardedAt: new Date(),
      rewardAmountReferrer: 200, rewardAmountReferred: 100,
    },
  })

  // ---------------------------------------------------------------------
  // Driver incentive campaign — admin-configured target/reward, three
  // drivers at different points of progress, one already rewarded.
  // ---------------------------------------------------------------------
  const campaign = await prisma.incentiveCampaign.create({
    data: {
      name: "[SEED] Weekend Rush Bonus", description: "[SEED] Complete 10 rides this weekend for a Rs 1000 bonus",
      cityId: city.id, targetRideCount: 10, rewardAmount: 1000,
      startDate: new Date(Date.now() - 2 * 86_400_000), endDate: new Date(Date.now() + 5 * 86_400_000), status: "active", createdById: superAdminUser.id,
    },
  })
  const incentiveDrivers = driverProfiles.filter((d) => d.verificationStatus === "approved").slice(0, 4)
  if (incentiveDrivers[0]) await prisma.driverIncentiveProgress.create({ data: { driverId: incentiveDrivers[0].id, campaignId: campaign.id, currentCount: 3, status: "in_progress" } })
  if (incentiveDrivers[1]) await prisma.driverIncentiveProgress.create({ data: { driverId: incentiveDrivers[1].id, campaignId: campaign.id, currentCount: 7, status: "in_progress" } })
  if (incentiveDrivers[2]) {
    await prisma.driverIncentiveProgress.create({ data: { driverId: incentiveDrivers[2].id, campaignId: campaign.id, currentCount: 10, status: "rewarded" } })
    await prisma.incentiveReward.create({ data: { driverId: incentiveDrivers[2].id, campaignId: campaign.id, amount: 1000 } })
    const rewardedWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: incentiveDrivers[2].userId } })
    const newBal = round2(rewardedWallet.balance + 1000)
    await prisma.wallet.update({ where: { id: rewardedWallet.id }, data: { balance: newBal } })
    await prisma.transaction.create({ data: { walletId: rewardedWallet.id, type: "incentive_bonus", amount: 1000, balanceAfter: newBal, description: "[SEED] Weekend Rush Bonus reward" } })
  }

  // ---------------------------------------------------------------------
  // Scheduled rides — two passengers with an upcoming booking.
  // ---------------------------------------------------------------------
  for (let i = 0; i < 2; i++) {
    const passenger = passengers[30 + i]
    const pickupPlace = place()
    const destPlace = place()
    const pickup = await createLocation(passenger.id, pickupPlace)
    const destination = await createLocation(passenger.id, destPlace)
    await prisma.scheduledRide.create({
      data: {
        passengerId: passenger.passengerProfile!.id, cityId: city.id, vehicleTypeId: vehicleTypes[i % vehicleTypes.length].id,
        pickupLocationId: pickup.id, destinationLocationId: destination.id,
        bookingMode: "quick_match", scheduledFor: new Date(Date.now() + (i + 1) * 6 * 3_600_000), status: "scheduled",
      },
    })
  }

  // ---------------------------------------------------------------------
  // Business account — architecture-only (Phase 2 §14): a company with an
  // owner + two employee passengers, and a couple of historical rides
  // tagged to it so the member dashboard has something to show.
  // ---------------------------------------------------------------------
  const businessOwner = passengers[10]
  const businessAccount = await prisma.businessAccount.create({
    data: {
      companyName: "[SEED] Acme Traders", billingContactUserId: businessOwner.id, cityId: city.id, paymentMethod: "wallet",
      monthlySpendLimit: 50000,
      employees: {
        create: [
          { userId: businessOwner.id, role: "owner" },
          { userId: passengers[11].id, role: "member" },
          { userId: passengers[12].id, role: "member" },
        ],
      },
    },
  })
  const taggedRide = await prisma.ride.findFirst({ where: { status: "ride_completed", passenger: { userId: passengers[11].id } } })
  if (taggedRide) {
    await prisma.ride.update({ where: { id: taggedRide.id }, data: { businessAccountId: businessAccount.id } })
    await prisma.rideRequest.update({ where: { id: taggedRide.rideRequestId }, data: { businessAccountId: businessAccount.id } })
  }

  // ---------------------------------------------------------------------
  // Risk/fraud signals — demo entries for the manual review queue. These
  // only ever surface a user for human review; nothing here suspends an
  // account (Phase 3 §22).
  // ---------------------------------------------------------------------
  await prisma.riskEvent.create({
    data: { userId: passengers[6].id, type: "unusual_cancellation", severity: "medium", details: JSON.stringify({ note: "[SEED] Elevated cancellation rate this week" }) },
  })
  await prisma.riskEvent.create({
    data: { userId: drivers[7].id, type: "impossible_movement", severity: "high", details: JSON.stringify({ note: "[SEED] Implausible speed between two location pings" }) },
  })
  await prisma.riskScore.create({ data: { userId: passengers[6].id, score: 3 } })
  await prisma.riskScore.create({ data: { userId: drivers[7].id, score: 7 } })

  // One passenger has opted out of promotional notifications (never the
  // non-disableable safety/system types).
  await prisma.notificationPreference.create({ data: { userId: passengers[8].id, type: "promo", enabled: false } })

  // A driver document nearing expiry (within the 30-day warning window)
  // and one already expired, so the admin document-expiry queue isn't empty.
  await prisma.driverDocument.create({
    data: { driverId: drivers[8].driverProfile!.id, docType: "driving_license", fileUrl: "https://example.com/seed/license-renewal.jpg", status: "approved", expiresAt: new Date(Date.now() + 20 * 86_400_000) },
  })
  await prisma.driverDocument.create({
    data: { driverId: drivers[9].driverProfile!.id, docType: "insurance", fileUrl: "https://example.com/seed/insurance-old.pdf", status: "approved", expiresAt: new Date(Date.now() - 3 * 86_400_000) },
  })

  console.log("\n[SEED] Done.\n")
  console.log("Test accounts (all seed/demo data):")
  console.log(`  Passenger: +923001000001 / ${PASSENGER_PASSWORD}  (any of +923001000001 .. +923001000${String(PASSENGER_NAMES.length).padStart(3, "0")})`)
  console.log(`  Driver:    +923002000001 / ${DRIVER_PASSWORD}     (any of +923002000001 .. +923002000030; last 5 are pending verification)`)
  console.log(`  Admin (super_admin): +923000000001 / ${ADMIN_PASSWORD}`)
  console.log(`  Admin (ops_manager): +923000000002 / ${ADMIN_PASSWORD}`)
  console.log(`\n  ${PASSENGER_NAMES.length} passengers, ${DRIVER_NAMES.length} drivers, ${HISTORICAL_RIDE_COUNT} historical rides, plus favorites, referrals, incentives, a scheduled ride, a business account, and risk/document-expiry demo entries.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
