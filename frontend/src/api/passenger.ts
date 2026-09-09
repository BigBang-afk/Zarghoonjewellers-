import { api } from "./client"

export interface SavedPlace {
  id: string
  label: string
  address: string
  lat: number
  lng: number
}
export interface RecentPlace {
  id: string
  address: string
  lat: number
  lng: number
}

export const passengerApi = {
  savedPlaces: () => api.get<{ locations: SavedPlace[] }>("/passenger/locations/saved"),
  addSavedPlace: (input: { label: string; address: string; lat: number; lng: number }) =>
    api.post<{ location: SavedPlace }>("/passenger/locations/saved", input),
  removeSavedPlace: (id: string) => api.delete<void>(`/passenger/locations/saved/${id}`),
  recentPlaces: () => api.get<{ locations: RecentPlace[] }>("/passenger/locations/recent"),
  rideHistory: () => api.get<{ rides: unknown[] }>("/passenger/ride-history"),
}
