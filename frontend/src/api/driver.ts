import { api } from "./client"
import type { DriverEarningsSummary, DriverIncentiveSummary, IncomingRequestSummary, RideSummary } from "../types"

export const driverApi = {
  me: () => api.get<{ driverProfile: Record<string, unknown> }>("/driver/me"),
  setAvailability: (status: "online" | "offline") => api.patch<{ driverProfile: Record<string, unknown> }>("/driver/me/availability", { status }),
  updateLocation: (lat: number, lng: number) => api.patch<void>("/driver/me/location", { lat, lng }),
  incomingRequests: () => api.get<{ offers: IncomingRequestSummary[] }>("/driver/me/incoming-requests"),
  activeRide: () => api.get<{ ride: RideSummary | null }>("/driver/me/active-ride"),
  earnings: () => api.get<DriverEarningsSummary>("/driver/me/earnings"),
  transactions: () => api.get<{ transactions: unknown[] }>("/driver/me/transactions"),
  rideHistory: () => api.get<{ rides: unknown[] }>("/driver/ride-history"),
  incentives: () => api.get<DriverIncentiveSummary>("/driver/me/incentives"),
}
