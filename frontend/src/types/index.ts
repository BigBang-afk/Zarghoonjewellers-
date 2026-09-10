// Shared frontend types mirroring backend DTOs (backend/src/types/enums.ts,
// backend/docs/09-api-architecture.md). Kept intentionally loose (many
// `unknown`/optional fields) since this consumes a real but evolving API —
// only the fields the UI actually reads are typed strictly.

export type UserRole = "passenger" | "driver" | "admin"

export interface PublicUser {
  id: string
  fullName: string
  phone: string
  email: string | null
  role: UserRole
  status: string
  photoUrl: string | null
}

export interface VehicleType {
  id: string
  code: "bike" | "rickshaw" | "economy" | "standard" | "premium"
  name: string
  capacity: number
}

export interface City {
  id: string
  name: string
  status: string
  currencyCode: string
}

export interface FareEstimate {
  route: { distanceKm: number; durationMin: number }
  fare: {
    currencyCode: string
    baseFare: number
    distanceCharge: number
    durationCharge: number
    subtotal: number
    demandMultiplier: number
    suggestedFare: number
    minimumFare: number
    maximumFare: number | null
    commissionRate: number
    /** Phase 3 §3 — a labeled estimate range, never presented as a locked-in price. */
    typicalRangeLow: number
    typicalRangeHigh: number
    isEstimate: true
  }
}

export type BookingMode = "quick_match" | "competitive_offer"

export interface RideRequestDispatch {
  status: "dispatched" | "no_drivers" | "skipped"
  driverId?: string
  offerId?: string
  driversNotified?: number
}

export interface CreateRideRequestResult {
  request: { id: string; status: string; proposedFare: number; suggestedFare: number }
  fare: FareEstimate["fare"]
  route: FareEstimate["route"]
  dispatch: RideRequestDispatch
}

export interface DriverOfferSummary {
  id: string
  status: string
  offerPrice: number
  etaMin: number
  distanceKm: number
  expiresAt: string
  driver: {
    id: string
    name: string
    photoUrl: string | null
    rating: number
    completedRides: number
    cancellationRate: number
    verified: boolean
  }
  vehicle: { model: string; color: string | null; plateNumber: string }
  counterOffer: { id: string; counterPrice: number; expiresAt: string } | null
}

export interface IncomingRequestSummary {
  id: string // offer id
  rideRequestId: string
  bookingMode: BookingMode
  pickup: string
  destination: string
  distanceKm: number
  etaMin: number
  offerPrice: number
  paymentMethod: string
  expiresAt: string
  passenger: { name: string; rating: number }
}

export type RideStatus =
  | "driver_selected"
  | "driver_arriving"
  | "driver_arrived"
  | "ride_started"
  | "ride_completed"
  | "cancelled_by_passenger"
  | "cancelled_by_driver"
  | "expired"
  | "disputed"

export interface RideSummary {
  id: string
  status: RideStatus
  agreedFare: number
  finalFare: number | null
  distanceKm: number | null
  durationMin: number | null
  paymentMethod: string
  shareToken: string | null
  passenger: { userId: string; user: PublicUser }
  driver: { id: string; userId: string; user: PublicUser; ratingAvg?: number; city?: { currencyCode: string } }
  vehicle: { make: string; model: string; color: string | null; plateNumber: string }
  pickup: { address: string; lat: number; lng: number }
  destination: { address: string; lat: number; lng: number }
  createdAt: string
}

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  read: boolean
  createdAt: string
  data?: Record<string, unknown> | null
}

export interface DriverEarningsSummary {
  currencyCode: string
  walletBalanceRs: number
  pendingBalanceRs: number
  paidBalanceRs: number
  today: { totalRs: number; rides: number; averageFareRs: number }
  week: { totalRs: number; rides: number; averageFareRs: number }
  month: { totalRs: number; rides: number; averageFareRs: number }
  charts: {
    daily: { label: string; totalRs: number; rides: number }[]
    weekly: { label: string; totalRs: number; rides: number }[]
    monthly: { label: string; totalRs: number; rides: number }[]
  }
  earningsPerHourRs: number
  completedRides: number
  cancelledRides: number
  acceptanceRate: number
  cancellationRate: number
  rating: number
}

export interface PayoutRequest {
  id: string
  driverId: string
  amount: number
  method: string
  status: "requested" | "processing" | "completed" | "failed" | "cancelled"
  reference: string | null
  notes: string | null
  createdAt: string
  processedAt: string | null
}

export interface DriverIncentiveSummary {
  activeProgress: {
    id: string
    currentCount: number
    status: string
    campaign: { id: string; name: string; description: string | null; targetRideCount: number; rewardAmount: number; endDate: string }
  }[]
  recentRewards: { id: string; amount: number; awardedAt: string; campaignId: string }[]
}

export interface WalletTransaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  description: string | null
  createdAt: string
}

export interface FavoriteDriverSummary {
  id: string
  driverId: string
  name: string
  rating: number
  vehicle: string | null
  addedAt: string
}

export interface AdminKpis {
  /** null when this is a platform-wide (no city filter) view spanning more than one currency. */
  currencyCode: string | null
  totalPassengers: number
  activePassengers: number
  totalDrivers: number
  onlineDrivers: number
  ridesRequestedToday: number
  completedToday: number
  cancelledToday: number
  activeRides: number
  grossBookingValueRs: number
  platformRevenueRs: number
  driverEarningsRs: number
  avgFareRs: number
  avgDurationMin: number
  driverCancellationRatePct: number
  passengerCancellationRatePct: number
  repeatPassengerRatePct: number
  pendingDriverVerifications: number
}

export interface DriverAcquisitionCampaign {
  id: string
  name: string
  code: string
  description: string | null
  cityId: string | null
  vehicleTypeId: string | null
  targetDriverCount: number
  incentiveAmount: number | null
  startDate: string
  endDate: string
  status: "draft" | "active" | "paused" | "completed"
  city?: { name: string; currencyCode: string } | null
  vehicleType?: { name: string } | null
}

export interface ReferralSummary {
  code: string | null
  currencyCode: string
  referralsMade: {
    id: string
    referredName: string
    status: "pending" | "rewarded"
    rewardAmountReferrer: number | null
    createdAt: string
    rewardedAt: string | null
  }[]
  totalRewardedRs: number
}

export type DocType = "national_id" | "driving_license" | "vehicle_registration" | "insurance" | "route_permit" | "profile_photo"

export interface DriverDocument {
  id: string
  docType: DocType
  fileUrl: string
  status: "pending" | "approved" | "rejected" | "expired"
  rejectionReason: string | null
  expiresAt: string | null
  createdAt: string
}

export interface DriverFunnelStage {
  stage: "applications" | "verification_pending" | "approved" | "online" | "first_ride" | "active"
  count: number
}
