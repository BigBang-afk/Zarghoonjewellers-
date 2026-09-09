import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { mapProvider } from "./maps/HaversineMapProvider.js"
import { haversineKm } from "../utils/geo.js"

export interface MatchCandidate {
  driverId: string
  userId: string
  vehicleId: string
  distanceKm: number
  etaMin: number
  score: number
  driverName: string
  rating: number
  acceptanceRate: number
  vehicleModel: string
  vehicleColor: string | null
  plateNumber: string
}

/**
 * Driver discovery + scoring (docs/06 §3, Phase 2 §6). Radius starts at
 * the admin-configured initial radius and expands through the configured
 * steps (never a value hard-coded in this function) until either enough
 * drivers are found or the max radius is reached.
 *
 * Eligibility (hard filters, applied in order): online, not already on a
 * trip, verified, matching vehicle type, within the current search
 * radius. Scoring only uses operational signals (ETA/distance,
 * acceptance history, rating, idle time) — never anything that could
 * proxy a protected characteristic.
 */
export async function findEligibleDrivers(params: {
  cityId: string
  vehicleTypeId: string
  pickup: { lat: number; lng: number }
  excludeDriverIds?: string[]
  limit?: number
}): Promise<{ candidates: MatchCandidate[]; radiusUsedKm: number }> {
  const [initialRadius, steps, maxRadius] = await Promise.all([
    getSetting("matching.initialRadiusKm"),
    getSetting("matching.radiusExpansionStepsKm"),
    getSetting("matching.maxRadiusKm"),
  ])

  const radii = [initialRadius, ...steps].filter((r) => r <= maxRadius)
  if (radii[radii.length - 1] !== maxRadius) radii.push(maxRadius)

  const pool = await prisma.driverProfile.findMany({
    where: {
      cityId: params.cityId,
      availabilityStatus: "online",
      verificationStatus: "approved",
      deletedAt: null,
      id: { notIn: params.excludeDriverIds ?? [] },
      lastLat: { not: null },
      lastLng: { not: null },
      vehicles: { some: { vehicleTypeId: params.vehicleTypeId, status: "active" } },
    },
    include: {
      user: true,
      vehicles: { where: { vehicleTypeId: params.vehicleTypeId, status: "active" }, take: 1 },
    },
  })

  let radiusUsedKm = radii[0]
  let withinRadius: typeof pool = []

  for (const radius of radii) {
    withinRadius = pool.filter(
      (d) => haversineKm(params.pickup, { lat: d.lastLat!, lng: d.lastLng! }) <= radius,
    )
    radiusUsedKm = radius
    if (withinRadius.length > 0) break
  }

  const vehicleTypeRow = await prisma.vehicleType.findUnique({ where: { id: params.vehicleTypeId } })

  const scored = await Promise.all(
    withinRadius.map(async (d) => {
      const vehicle = d.vehicles[0]
      const route = await mapProvider.estimateRoute(params.pickup, { lat: d.lastLat!, lng: d.lastLng! }, vehicleTypeRow?.code ?? "economy")
      const idleMinutes = d.lastLocationAt ? (Date.now() - d.lastLocationAt.getTime()) / 60_000 : 0

      // Lower is better for eta/distance; higher is better for the rest.
      // Weighted into a single 0-100ish score — weights are the kind of
      // thing that would move to PlatformSettings if tuned in production.
      const etaScore = Math.max(0, 100 - route.durationMin * 4)
      const acceptanceScore = d.acceptanceRate
      const ratingScore = d.ratingAvg * 20
      const fairnessScore = Math.min(20, idleMinutes)
      const score = etaScore * 0.4 + acceptanceScore * 0.25 + ratingScore * 0.25 + fairnessScore * 0.1

      const candidate: MatchCandidate = {
        driverId: d.id,
        userId: d.userId,
        vehicleId: vehicle?.id ?? "",
        distanceKm: route.distanceKm,
        etaMin: route.durationMin,
        score: Math.round(score * 100) / 100,
        driverName: d.user.fullName,
        rating: d.ratingAvg,
        acceptanceRate: d.acceptanceRate,
        vehicleModel: vehicle ? `${vehicle.make} ${vehicle.model}` : "",
        vehicleColor: vehicle?.color ?? null,
        plateNumber: vehicle?.plateNumber ?? "",
      }
      return candidate
    }),
  )

  scored.sort((a, b) => b.score - a.score)
  const limited = params.limit ? scored.slice(0, params.limit) : scored

  return { candidates: limited, radiusUsedKm }
}
