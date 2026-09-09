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

const PASSENGER_NAMES = [
  "Ayesha Khan", "Bilal Ahmed", "Sara Malik", "Usman Tariq", "Hina Shah",
  "Danish Iqbal", "Mahnoor Ali", "Fahad Sheikh", "Zara Baig", "Hamza Riaz",
]

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
    "vehicleDocument", "vehicle", "driverDocument", "driverProfile",
    "wallet", "passengerProfile", "location",
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
    data: { countryId: country.id, name: "Islamabad", status: "live", currencyCode: "PKR", timezone: "Asia/Karachi", centerLat: ISB_CENTER.lat, centerLng: ISB_CENTER.lng },
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

  console.log("[SEED] Creating 10 passengers...")
  const passengerPasswordHash = await bcrypt.hash(PASSENGER_PASSWORD, 10)
  const passengers = []
  for (let i = 0; i < PASSENGER_NAMES.length; i++) {
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
        wallet: { create: { balance: 0, currencyCode: "PKR" } },
      },
      include: { passengerProfile: true },
    })
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
    drivers.push(user as never)
  }

  const driverProfiles = await prisma.driverProfile.findMany({ include: { vehicles: true, user: true } })
  const onlineDrivers = driverProfiles.filter((d) => d.availabilityStatus === "online")

  async function createLocation(userId: string, p: { address: string; lat: number; lng: number }) {
    return prisma.location.create({ data: { userId, ...p } })
  }

  // ---------------------------------------------------------------------
  // Completed rides (8) — full lifecycle incl. payment, commission, wallet
  // transaction, and ratings.
  // ---------------------------------------------------------------------
  console.log("[SEED] Creating completed rides with payments and ratings...")
  for (let i = 0; i < 8; i++) {
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
        expiresAt: new Date(Date.now() - 3600_000),
      },
    })
    const offer = await prisma.rideOffer.create({
      data: {
        rideRequestId: request.id, driverId: driver.id, vehicleId: vehicle.id,
        offerPrice: fare, etaMin: 5, distanceKm, status: "accepted",
        expiresAt: new Date(Date.now() - 3000_000),
      },
    })

    const acceptedAt = new Date(Date.now() - (8 - i) * 3600_000)
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
        amount: fare, currencyCode: "PKR", providerReference: `seed_pay_${i}`, capturedAt: completedAt,
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

    // Passenger rates driver on most rides; driver rates passenger sometimes.
    const score = 4 + Math.round(Math.random())
    await prisma.rating.create({
      data: { rideId: ride.id, raterId: passenger.id, rateeId: driver.userId, score,
        review: i % 3 === 0 ? { create: { comment: "[SEED] Great ride, smooth and on time." } } : undefined },
    })
    if (i % 2 === 0) {
      await prisma.rating.create({ data: { rideId: ride.id, raterId: driver.userId, rateeId: passenger.id, score: 5 } })
    }
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

  console.log("\n[SEED] Done.\n")
  console.log("Test accounts (all seed/demo data):")
  console.log(`  Passenger: +923001000001 / ${PASSENGER_PASSWORD}  (any of +923001000001 .. +923001000010)`)
  console.log(`  Driver:    +923002000001 / ${DRIVER_PASSWORD}     (any of +923002000001 .. +923002000030; last 5 are pending verification)`)
  console.log(`  Admin (super_admin): +923000000001 / ${ADMIN_PASSWORD}`)
  console.log(`  Admin (ops_manager): +923000000002 / ${ADMIN_PASSWORD}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
