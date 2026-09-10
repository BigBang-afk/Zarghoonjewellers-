import { prisma } from "../../utils/prisma.js"
import { haversineKm } from "../../utils/geo.js"
import type { GeocodeResult, LatLng, MapProvider, ReverseGeocodeResult, RouteEstimate } from "./MapProvider.js"

// Straight-line distance is shorter than road distance; this factor
// approximates typical urban road-network detour. Average speeds are
// per vehicle type to reflect e.g. bikes threading traffic faster than
// cars. Both are reasonable MVP defaults, not measured real-world data.
const ROAD_DISTANCE_FACTOR = 1.3

const AVG_SPEED_KMH: Record<string, number> = {
  bike: 28,
  rickshaw: 22,
  economy: 24,
  standard: 24,
  premium: 26,
}
const DEFAULT_SPEED_KMH = 24

/** How close (km) a reverse-geocode lookup will match an existing saved/recent Location before giving up and formatting raw coordinates instead. */
const REVERSE_GEOCODE_MATCH_RADIUS_KM = 0.3

/**
 * Real, deterministic distance/ETA math with no live traffic or road
 * network data (documented on the MapProvider interface). geocode/
 * reverseGeocode here are honest placeholders: they search RIVO's own
 * `Location` table (addresses real users have actually saved/searched)
 * rather than fabricating a result — a genuine address database
 * (Google/Mapbox) is the production upgrade, see MapProvider.ts.
 */
export class HaversineMapProvider implements MapProvider {
  readonly name = "haversine"

  async estimateRoute(origin: LatLng, destination: LatLng, vehicleTypeCode: string): Promise<RouteEstimate> {
    const straightLineKm = haversineKm(origin, destination)
    const distanceKm = Math.round(straightLineKm * ROAD_DISTANCE_FACTOR * 100) / 100
    const speed = AVG_SPEED_KMH[vehicleTypeCode] ?? DEFAULT_SPEED_KMH
    const durationMin = Math.max(2, Math.round((distanceKm / speed) * 60))
    return { distanceKm, durationMin }
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const trimmed = address.trim()
    if (!trimmed) return null
    const match = await prisma.location.findFirst({
      where: { address: { contains: trimmed } },
      orderBy: { createdAt: "desc" },
    })
    if (!match) return null
    return { lat: match.lat, lng: match.lng, formattedAddress: match.address }
  }

  async reverseGeocode(point: LatLng): Promise<ReverseGeocodeResult | null> {
    // No spatial index in SQLite dev — a small bounding box keeps this
    // cheap; a production geocoder does this server-side properly.
    const boxDeg = REVERSE_GEOCODE_MATCH_RADIUS_KM / 111
    const candidates = await prisma.location.findMany({
      where: {
        lat: { gte: point.lat - boxDeg, lte: point.lat + boxDeg },
        lng: { gte: point.lng - boxDeg, lte: point.lng + boxDeg },
      },
      take: 20,
    })
    let closest: { address: string; distanceKm: number } | null = null
    for (const c of candidates) {
      const distanceKm = haversineKm(point, c)
      if (distanceKm <= REVERSE_GEOCODE_MATCH_RADIUS_KM && (!closest || distanceKm < closest.distanceKm)) {
        closest = { address: c.address, distanceKm }
      }
    }
    if (closest) return { address: closest.address }
    return { address: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)} (approximate — no known address nearby)` }
  }
}

export const mapProvider: MapProvider = new HaversineMapProvider()
