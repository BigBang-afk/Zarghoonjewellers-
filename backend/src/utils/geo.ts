/** Great-circle distance in km between two lat/lng points (haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return R * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}
