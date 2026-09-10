export interface LatLng {
  lat: number
  lng: number
}

export interface RouteEstimate {
  distanceKm: number
  durationMin: number
}

export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
}

export interface ReverseGeocodeResult {
  address: string
}

/**
 * Abstraction over a routing/maps provider (Phase 2 §20, Phase 4 §6).
 * RIVO must not be tightly coupled to one map SDK — every consumer (Fare
 * Engine, Matching Engine, ride distance/duration calculations,
 * address search) depends on this interface, never on a concrete
 * implementation.
 *
 * `HaversineMapProvider` (the only implementation wired up today) does
 * real, deterministic distance/ETA math — not a fake — but it is a
 * straight-line approximation with no live traffic or road network data,
 * and its geocode/reverseGeocode are clearly-labeled placeholders (no
 * real address database exists in dev). Swapping in a
 * `GOOGLE_MAPS_API_KEY` / `MAPBOX_API_KEY` behind a new provider class
 * (implementing this same interface) is the production upgrade path; no
 * other code changes — see `maps.provider` in PlatformSettings for the
 * admin-configurable selector and `services/maps/index.ts` for where a
 * real adapter gets wired in.
 */
export interface MapProvider {
  readonly name: string
  estimateRoute(origin: LatLng, destination: LatLng, vehicleTypeCode: string): Promise<RouteEstimate>
  /** Free-text address -> coordinates. Returns null if the address can't be resolved. */
  geocode(address: string): Promise<GeocodeResult | null>
  /** Coordinates -> a human-readable address. Returns null if nothing is found nearby. */
  reverseGeocode(point: LatLng): Promise<ReverseGeocodeResult | null>
}
