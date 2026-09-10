import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { mapProvider } from "./maps/HaversineMapProvider.js"
import { haversineKm } from "../utils/geo.js"

/** Transparent per-factor breakdown behind a candidate's score — surfaced to
 * the admin dashboard (Phase 3 §1: "create a transparent internal matching
 * score") so scoring is auditable, never a black box. */
export interface MatchScoreBreakdown {
  etaScore: number
  acceptanceScore: number
  ratingScore: number
  fairnessScore: number
  favoriteBonus: number
  weights: { eta: number; acceptance: number; rating: number; fairness: number }
}

export interface MatchCandidate {
  driverId: string
  userId: string
  vehicleId: string
  distanceKm: number
  etaMin: number
  score: number
  scoreBreakdown: MatchScoreBreakdown
  driverName: string
  rating: number
  acceptanceRate: number
  cancellationRate: number
  vehicleModel: string
  vehicleColor: string | null
  plateNumber: string
  locationAgeMin: number
  isFavorite: boolean
}

/**
 * Driver discovery + scoring (docs/06 §3, Phase 2 §6, Phase 3 §1). Radius
 * starts at the admin-configured initial radius and expands through the
 * configured steps (never a value hard-coded in this function) until
 * either enough drivers are found or the max radius is reached.
 *
 * Eligibility (hard filters, applied in order): online, not already on a
 * trip, verified, matching vehicle type, location reported within the
 * configured freshness window (Phase 3 §5: "graceful handling of stale
 * locations" — a driver whose last ping is too old is excluded from
 * matching rather than shown at a location that may no longer be true),
 * within the current search radius.
 *
 * Scoring only uses operational signals (ETA/distance, acceptance
 * history, rating, idle-time fairness, and an optional favorite-driver
 * preference) — never anything that could proxy a protected
 * characteristic. Weights are admin-configurable via PlatformSettings,
 * not hard-coded, and the full per-factor breakdown is returned so the
 * score is auditable rather than a black box.
 */
export async function findEligibleDrivers(params: {
  cityId: string
  vehicleTypeId: string
  pickup: { lat: number; lng: number }
  excludeDriverIds?: string[]
  excludeUserIds?: string[]
  favoriteDriverIds?: string[]
  limit?: number
}): Promise<{ candidates: MatchCandidate[]; radiusUsedKm: number; staleExcludedCount: number }> {
  const [platformInitialRadius, steps, maxRadius, stalenessMinutes, wEta, wAcceptance, wRating, wFairness, favoriteBoost, city] =
    await Promise.all([
      getSetting("matching.initialRadiusKm"),
      getSetting("matching.radiusExpansionStepsKm"),
      getSetting("matching.maxRadiusKm"),
      getSetting("matching.locationStalenessMinutes"),
      getSetting("matching.weightEta"),
      getSetting("matching.weightAcceptance"),
      getSetting("matching.weightRating"),
      getSetting("matching.weightFairness"),
      getSetting("matching.favoriteDriverBoost"),
      prisma.city.findUnique({ where: { id: params.cityId }, select: { searchRadiusKm: true } }),
    ])
  // A city-specific search radius (Phase 5 §1) overrides the platform
  // default's starting point, but never the platform's own safety
  // ceiling — a city can search wider or narrower to start, not beyond
  // maxRadiusKm.
  const initialRadius = Math.min(city?.searchRadiusKm ?? platformInitialRadius, maxRadius)

  const radii = [initialRadius, ...steps].filter((r) => r <= maxRadius)
  if (radii[radii.length - 1] !== maxRadius) radii.push(maxRadius)

  const staleCutoff = new Date(Date.now() - stalenessMinutes * 60_000)

  const [allOnlinePool, freshPool] = await Promise.all([
    prisma.driverProfile.count({
      where: {
        cityId: params.cityId,
        availabilityStatus: "online",
        verificationStatus: "approved",
        deletedAt: null,
        id: { notIn: params.excludeDriverIds ?? [] },
        userId: { notIn: params.excludeUserIds ?? [] },
        vehicles: { some: { vehicleTypeId: params.vehicleTypeId, status: "active" } },
      },
    }),
    prisma.driverProfile.findMany({
      where: {
        cityId: params.cityId,
        availabilityStatus: "online",
        verificationStatus: "approved",
        deletedAt: null,
        id: { notIn: params.excludeDriverIds ?? [] },
        userId: { notIn: params.excludeUserIds ?? [] },
        lastLat: { not: null },
        lastLng: { not: null },
        lastLocationAt: { gte: staleCutoff },
        vehicles: { some: { vehicleTypeId: params.vehicleTypeId, status: "active" } },
      },
      include: {
        user: true,
        vehicles: { where: { vehicleTypeId: params.vehicleTypeId, status: "active" }, take: 1 },
      },
      // Phase 4 §29 — bounds the worst case for a single very large city's
      // online-driver pool before the in-memory haversine filter below runs.
      // A real geospatial index (PostGIS/geohash) is the correct fix once a
      // city's online-driver count regularly exceeds this; tracked as a
      // known scaling limit, not solved here.
      take: 500,
    }),
  ])
  const staleExcludedCount = Math.max(0, allOnlinePool - freshPool.length)

  let radiusUsedKm = radii[0]
  let withinRadius: typeof freshPool = []

  for (const radius of radii) {
    withinRadius = freshPool.filter((d) => haversineKm(params.pickup, { lat: d.lastLat!, lng: d.lastLng! }) <= radius)
    radiusUsedKm = radius
    if (withinRadius.length > 0) break
  }

  const vehicleTypeRow = await prisma.vehicleType.findUnique({ where: { id: params.vehicleTypeId } })
  const favoriteSet = new Set(params.favoriteDriverIds ?? [])

  const scored = await Promise.all(
    withinRadius.map(async (d) => {
      const vehicle = d.vehicles[0]
      const route = await mapProvider.estimateRoute(params.pickup, { lat: d.lastLat!, lng: d.lastLng! }, vehicleTypeRow?.code ?? "economy")
      const idleMinutes = d.lastLocationAt ? (Date.now() - d.lastLocationAt.getTime()) / 60_000 : 0
      const isFavorite = favoriteSet.has(d.id)

      // Lower is better for eta/distance; higher is better for the rest.
      // Each factor normalized to a comparable ~0-100 range, then combined
      // via admin-configurable weights (docs/12 §1 breakdown returned
      // alongside the candidate for transparency).
      const etaScore = Math.max(0, 100 - route.durationMin * 4)
      const acceptanceScore = d.acceptanceRate
      const ratingScore = d.ratingAvg * 20
      const fairnessScore = Math.min(20, idleMinutes)
      const favoriteBonus = isFavorite ? favoriteBoost : 0
      const score = etaScore * wEta + acceptanceScore * wAcceptance + ratingScore * wRating + fairnessScore * wFairness + favoriteBonus

      const candidate: MatchCandidate = {
        driverId: d.id,
        userId: d.userId,
        vehicleId: vehicle?.id ?? "",
        distanceKm: route.distanceKm,
        etaMin: route.durationMin,
        score: Math.round(score * 100) / 100,
        scoreBreakdown: {
          etaScore: Math.round(etaScore * 100) / 100,
          acceptanceScore: Math.round(acceptanceScore * 100) / 100,
          ratingScore: Math.round(ratingScore * 100) / 100,
          fairnessScore: Math.round(fairnessScore * 100) / 100,
          favoriteBonus,
          weights: { eta: wEta, acceptance: wAcceptance, rating: wRating, fairness: wFairness },
        },
        driverName: d.user.fullName,
        rating: d.ratingAvg,
        acceptanceRate: d.acceptanceRate,
        cancellationRate: d.cancellationRate,
        vehicleModel: vehicle ? `${vehicle.make} ${vehicle.model}` : "",
        vehicleColor: vehicle?.color ?? null,
        plateNumber: vehicle?.plateNumber ?? "",
        locationAgeMin: Math.round(idleMinutes * 10) / 10,
        isFavorite,
      }
      return candidate
    }),
  )

  scored.sort((a, b) => b.score - a.score)
  const limited = params.limit ? scored.slice(0, params.limit) : scored

  return { candidates: limited, radiusUsedKm, staleExcludedCount }
}
