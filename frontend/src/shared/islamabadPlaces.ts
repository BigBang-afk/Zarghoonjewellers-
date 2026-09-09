/**
 * A small curated list of well-known Islamabad points of interest, used
 * as a "Popular destinations" fallback when a passenger has no saved or
 * recent places yet. This is static UI content (like any app's city
 * launch POI list), not a simulated search/geocoding API — RIVO does
 * not pretend to have live geocoding in Phase 2 (see docs/06 §20 / the
 * MapProvider abstraction).
 */
export const POPULAR_ISLAMABAD_PLACES = [
  { address: "Centaurus Mall, F-8", lat: 33.7089, lng: 73.0498 },
  { address: "Faisal Mosque, Shah Faisal Ave", lat: 33.7295, lng: 73.0372 },
  { address: "Islamabad International Airport", lat: 33.5606, lng: 72.8318 },
  { address: "Blue Area, Jinnah Avenue", lat: 33.7089, lng: 73.0629 },
  { address: "G-9 Markaz", lat: 33.7 , lng: 73.038 },
  { address: "F-10 Markaz", lat: 33.6982, lng: 73.0114 },
  { address: "Pakistan Monument, Shakarparian", lat: 33.6938, lng: 73.0652 },
  { address: "Bahria Town Phase 4", lat: 33.5323, lng: 73.2438 },
]

export const ISLAMABAD_CURRENT_LOCATION_FALLBACK = { address: "F-8 Markaz, Islamabad", lat: 33.7089, lng: 73.0455 }
