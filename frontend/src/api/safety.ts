import { api } from "./client"

export const safetyApi = {
  sos: (input: { rideId?: string; lat: number; lng: number; note?: string }) =>
    api.post<{ safetyEvent: unknown; message: string }>("/safety/sos", input),
  report: (input: { rideId: string; againstUserId: string; reason: string }) =>
    api.post<{ dispute: unknown; safetyEvent: unknown }>("/safety/report", input),
  shareTrip: (rideId: string) => api.post<{ shareToken: string; shareUrl: string }>(`/safety/share-trip/${rideId}`),
}
