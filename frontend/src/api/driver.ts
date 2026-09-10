import { api } from "./client"
import type { DriverDocument, DriverEarningsSummary, DriverIncentiveSummary, IncomingRequestSummary, PayoutRequest, RideSummary } from "../types"

export const driverApi = {
  me: () => api.get<{ driverProfile: Record<string, unknown> }>("/driver/me"),
  documents: () => api.get<{ documents: DriverDocument[] }>("/driver/me/documents"),
  submitDocument: (docType: string, fileUrl: string, expiresAt?: string) =>
    api.post<{ document: DriverDocument }>("/driver/me/documents", { docType, fileUrl, expiresAt }),
  setAvailability: (status: "online" | "offline") => api.patch<{ driverProfile: Record<string, unknown> }>("/driver/me/availability", { status }),
  updateLocation: (lat: number, lng: number, accuracyMeters?: number) => api.patch<void>("/driver/me/location", { lat, lng, accuracyMeters }),
  payouts: () => api.get<{ payouts: PayoutRequest[] }>("/driver/me/payouts"),
  requestPayout: (amount: number, method: string) => api.post<{ payout: PayoutRequest }>("/driver/me/payouts", { amount, method }),
  cancelPayout: (id: string) => api.post<{ payout: PayoutRequest }>(`/driver/me/payouts/${id}/cancel`),
  incomingRequests: () => api.get<{ offers: IncomingRequestSummary[] }>("/driver/me/incoming-requests"),
  activeRide: () => api.get<{ ride: RideSummary | null }>("/driver/me/active-ride"),
  earnings: () => api.get<DriverEarningsSummary>("/driver/me/earnings"),
  transactions: () => api.get<{ transactions: unknown[] }>("/driver/me/transactions"),
  rideHistory: () => api.get<{ rides: unknown[] }>("/driver/ride-history"),
  incentives: () => api.get<DriverIncentiveSummary>("/driver/me/incentives"),
  demandMap: (range?: string) =>
    api.get<{ range: string; cells: { centerLat: number; centerLng: number; status: "green" | "yellow" | "red" }[] }>(
      "/driver/me/demand-map",
      range ? { range } : undefined,
    ),
}
