import { api } from "./client"
import type {
  BookingMode,
  CreateRideRequestResult,
  DriverOfferSummary,
  FareEstimate,
  RideSummary,
} from "../types"

export interface Place {
  address: string
  lat: number
  lng: number
}

export const ridesApi = {
  fareEstimate: (input: { cityId: string; vehicleTypeId: string; pickup: { lat: number; lng: number }; destination: { lat: number; lng: number } }) =>
    api.post<FareEstimate>("/fare-estimates", input),

  createRequest: (input: {
    cityId: string
    vehicleTypeId: string
    pickup: Place
    destination: Place
    bookingMode: BookingMode
    proposedFare?: number
    paymentMethod?: string
    promoCode?: string
    preferFavoriteDriver?: boolean
  }) => api.post<CreateRideRequestResult>("/ride-requests", input),

  getRequest: (id: string) => api.get<{ request: Record<string, unknown> }>(`/ride-requests/${id}`),
  cancelRequest: (id: string) => api.delete<{ ok: boolean }>(`/ride-requests/${id}`),
  getOffers: (id: string) =>
    api.get<{
      request: { id: string; status: string; proposedFare: number; suggestedFare: number }
      statusMessage: string
      pendingCount: number
      respondedCount: number
      offers: DriverOfferSummary[]
    }>(`/ride-requests/${id}/offers`),
  selectOffer: (rideRequestId: string, offerId: string) => api.post<{ ride: RideSummary }>(`/ride-requests/${rideRequestId}/select-offer`, { offerId }),

  acceptCounterOffer: (counterOfferId: string) => api.post<{ ride: RideSummary }>(`/counter-offers/${counterOfferId}/accept`),
  rejectCounterOffer: (counterOfferId: string) => api.post<{ ok: boolean }>(`/counter-offers/${counterOfferId}/reject`),

  // Driver-side
  acceptOffer: (offerId: string) => api.post<{ kind: "booked" | "accepted"; ride?: RideSummary }>(`/ride-offers/${offerId}/accept`),
  counterOffer: (offerId: string, counterPrice: number) => api.post<{ counterOffer: { id: string } }>(`/ride-offers/${offerId}/counter`, { counterPrice }),
  declineOffer: (offerId: string) => api.post<{ ok: boolean }>(`/ride-offers/${offerId}/decline`),

  // Ride lifecycle
  getRide: (id: string) => api.get<{ ride: RideSummary & { statusHistory: { status: string; changedAt: string }[] } }>(`/rides/${id}`),
  listRides: (query?: { status?: string; page?: number; pageSize?: number }) =>
    api.get<{ rides: RideSummary[]; total: number }>("/rides", query),
  updateStatus: (rideId: string, target: string, reason?: string) => api.post<{ ride: RideSummary }>(`/rides/${rideId}/status`, { target, reason }),
  submitRating: (rideId: string, score: number, comment?: string) => api.post<{ rating: unknown }>(`/rides/${rideId}/ratings`, { score, comment }),

  getMessages: (rideId: string) => api.get<{ messages: { id: string; senderId: string; body: string; createdAt: string }[] }>(`/rides/${rideId}/messages`),
  sendMessage: (rideId: string, body: string) => api.post<{ message: unknown }>(`/rides/${rideId}/messages`, { body }),
}
