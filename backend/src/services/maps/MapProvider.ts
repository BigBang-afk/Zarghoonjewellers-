export interface LatLng {
  lat: number
  lng: number
}

export interface RouteEstimate {
  distanceKm: number
  durationMin: number
}

/**
 * Abstraction over a routing/maps provider. RIVO must not be tightly
 * coupled to one map SDK (Phase 2 §20) — every consumer (Fare Engine,
 * Matching Engine, ride distance/duration calculations) depends on this
 * interface, never on a concrete implementation.
 *
 * `HaversineMapProvider` (the only implementation wired up today) is a
 * real, deterministic distance/ETA calculator — not a fake — but it is a
 * straight-line approximation with no live traffic or road network data.
 * Swapping in `GOOGLE_MAPS_API_KEY` / `MAPBOX_API_KEY` behind a new
 * provider class (implementing this same interface) is the production
 * upgrade path; no other code changes.
 */
export interface MapProvider {
  estimateRoute(origin: LatLng, destination: LatLng, vehicleTypeCode: string): Promise<RouteEstimate>
}
