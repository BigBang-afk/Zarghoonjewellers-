import { haversineKm } from "../../utils/geo.js"
import type { LatLng, MapProvider, RouteEstimate } from "./MapProvider.js"

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

export class HaversineMapProvider implements MapProvider {
  async estimateRoute(origin: LatLng, destination: LatLng, vehicleTypeCode: string): Promise<RouteEstimate> {
    const straightLineKm = haversineKm(origin, destination)
    const distanceKm = Math.round(straightLineKm * ROAD_DISTANCE_FACTOR * 100) / 100
    const speed = AVG_SPEED_KMH[vehicleTypeCode] ?? DEFAULT_SPEED_KMH
    const durationMin = Math.max(2, Math.round((distanceKm / speed) * 60))
    return { distanceKm, durationMin }
  }
}

export const mapProvider: MapProvider = new HaversineMapProvider()
