import bcrypt from "bcryptjs"
import { prisma } from "../src/utils/prisma.js"

export const PASSWORD = "TestPass123!"
let passwordHash: string | null = null

async function getPasswordHash() {
  if (!passwordHash) passwordHash = await bcrypt.hash(PASSWORD, 4) // low cost factor — tests only
  return passwordHash
}

const WIPE_ORDER = [
  "auditLog", "adminUser",
  "review", "rating", "message", "notification",
  "transaction", "commission", "payment",
  "rideStatusHistory", "rideLocation", "safetyEvent", "dispute", "supportTicket", "ride",
  "counterOffer", "rideOffer", "rideRequest",
  "promoRedemption", "favoriteDriver",
  "driverIncentiveProgress", "incentiveReward",
  "scheduledRide",
  "driverOnlineSession",
  "vehicleDocument", "vehicle", "driverDocument", "driverProfile",
  "wallet", "passengerProfile", "location",
  "businessEmployee", "businessAccount",
  "referral", "referralCode",
  "riskEvent", "riskScore", "notificationPreference", "userBlock",
  "incentiveCampaign",
  "refreshToken", "otpCode", "user",
  "fareRule", "cityVehicleType", "promotion", "serviceZone", "city", "country",
  "vehicleType", "platformSetting",
] as const

export async function resetDb() {
  for (const table of WIPE_ORDER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any)[table].deleteMany()
  }
}

export interface Fixtures {
  countryId: string
  cityId: string
  vehicleTypeIds: Record<"bike" | "rickshaw" | "economy" | "standard" | "premium", string>
  passenger1: { userId: string; profileId: string; phone: string }
  passenger2: { userId: string; profileId: string; phone: string }
  driver1: { userId: string; profileId: string; phone: string; vehicleId: string; lat: number; lng: number }
  driver2: { userId: string; profileId: string; phone: string; vehicleId: string; lat: number; lng: number }
  admin: { userId: string; phone: string }
}

const PICKUP = { lat: 33.7, lng: 73.02 }

export async function seedFixtures(): Promise<Fixtures> {
  const hash = await getPasswordHash()

  const country = await prisma.country.create({ data: { name: "Pakistan", isoCode: "PK", defaultCurrencyCode: "PKR" } })
  const city = await prisma.city.create({
    data: { countryId: country.id, name: "Islamabad", status: "live", currencyCode: "PKR", timezone: "Asia/Karachi" },
  })

  const typeDefs = [
    { code: "bike", name: "Bike", base: 60, perKm: 15, perMin: 2, min: 100 },
    { code: "rickshaw", name: "Rickshaw", base: 90, perKm: 20, perMin: 3, min: 150 },
    { code: "economy", name: "Economy", base: 150, perKm: 32, perMin: 5, min: 250 },
    { code: "standard", name: "Standard", base: 200, perKm: 42, perMin: 6, min: 320 },
    { code: "premium", name: "Premium", base: 350, perKm: 65, perMin: 9, min: 550 },
  ] as const

  const vehicleTypeIds = {} as Fixtures["vehicleTypeIds"]
  for (const t of typeDefs) {
    const vt = await prisma.vehicleType.create({ data: { code: t.code, name: t.name } })
    vehicleTypeIds[t.code] = vt.id
    await prisma.cityVehicleType.create({ data: { cityId: city.id, vehicleTypeId: vt.id } })
    await prisma.fareRule.create({
      data: {
        cityId: city.id, vehicleTypeId: vt.id, baseFare: t.base, perKmRate: t.perKm, perMinRate: t.perMin,
        minimumFare: t.min, maximumFare: 20000, commissionRate: 0.15, surgeMinMultiplier: 1, surgeMaxMultiplier: 1, // no surge noise in tests
      },
    })
  }

  async function makePassenger(name: string, phoneSuffix: string) {
    const user = await prisma.user.create({
      data: {
        fullName: name, phone: `+9231000000${phoneSuffix}`, passwordHash: hash, role: "passenger", status: "active",
        primaryCityId: city.id, phoneVerifiedAt: new Date(),
        passengerProfile: { create: {} },
        wallet: { create: { balance: 0, currencyCode: "PKR" } },
      },
      include: { passengerProfile: true },
    })
    return { userId: user.id, profileId: user.passengerProfile!.id, phone: user.phone }
  }

  async function makeDriver(name: string, phoneSuffix: string, vehicleTypeId: string, lat: number, lng: number, opts?: { online?: boolean; verified?: boolean }) {
    const online = opts?.online ?? true
    const verified = opts?.verified ?? true
    const user = await prisma.user.create({
      data: {
        fullName: name, phone: `+9231000001${phoneSuffix}`, passwordHash: hash, role: "driver", status: "active",
        primaryCityId: city.id, phoneVerifiedAt: new Date(),
        wallet: { create: { balance: 0, currencyCode: "PKR" } },
        driverProfile: {
          create: {
            cityId: city.id,
            verificationStatus: verified ? "approved" : "pending",
            availabilityStatus: online ? "online" : "offline",
            lastLat: online ? lat : null,
            lastLng: online ? lng : null,
            lastLocationAt: online ? new Date() : null,
            vehicles: { create: { vehicleTypeId, make: "Toyota", model: "Corolla", color: "White", plateNumber: `TST-${Math.floor(Math.random() * 100000)}`, status: verified ? "active" : "pending" } },
          },
        },
      },
      include: { driverProfile: { include: { vehicles: true } } },
    })
    return { userId: user.id, profileId: user.driverProfile!.id, phone: user.phone, vehicleId: user.driverProfile!.vehicles[0].id, lat, lng }
  }

  const passenger1 = await makePassenger("Test Passenger One", "1")
  const passenger2 = await makePassenger("Test Passenger Two", "2")
  const driver1 = await makeDriver("Test Driver One", "1", vehicleTypeIds.economy, PICKUP.lat + 0.01, PICKUP.lng + 0.01)
  const driver2 = await makeDriver("Test Driver Two", "2", vehicleTypeIds.economy, PICKUP.lat - 0.01, PICKUP.lng - 0.01)

  const adminUser = await prisma.user.create({
    data: {
      fullName: "Test Admin", phone: "+923100000099", passwordHash: hash, role: "admin", status: "active", phoneVerifiedAt: new Date(),
      adminProfile: { create: { role: "super_admin" } },
    },
  })

  return {
    countryId: country.id,
    cityId: city.id,
    vehicleTypeIds,
    passenger1,
    passenger2,
    driver1,
    driver2,
    admin: { userId: adminUser.id, phone: adminUser.phone },
  }
}

export const samplePickup = { address: "Test Pickup Point", ...PICKUP }
export const sampleDestination = { address: "Test Destination Point", lat: PICKUP.lat + 0.05, lng: PICKUP.lng + 0.05 }
