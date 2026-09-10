import { api } from "./client"
import type { FavoriteDriverSummary, WalletTransaction } from "../types"

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

  wallet: () => api.get<{ balance: number; currencyCode: string; transactions: WalletTransaction[] }>("/passenger/wallet"),
  walletTopup: (amount: number, method: "card" | "local_provider" = "card") =>
    api.post<{ balance: number; transaction: WalletTransaction }>("/passenger/wallet/topup", { amount, method }),

  validatePromo: (input: { code: string; cityId: string; vehicleTypeId: string; fareAmount: number }) =>
    api.post<{ promotionId: string; discountAmount: number }>("/passenger/promo/validate", input),

  favorites: () => api.get<{ favorites: FavoriteDriverSummary[] }>("/passenger/favorites"),
  addFavorite: (driverId: string) => api.post<{ favorite: unknown }>(`/passenger/favorites/${driverId}`),
  removeFavorite: (driverId: string) => api.delete<void>(`/passenger/favorites/${driverId}`),
}
