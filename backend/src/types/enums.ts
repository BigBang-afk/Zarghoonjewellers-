// Central definition of every status/enum-like string used across the app.
// Prisma stores these as plain `String` columns (SQLite has no enum type —
// see prisma/schema.prisma header) — these unions + the zod schemas in
// src/types/schemas.ts are what actually enforce valid values at the API
// boundary, per "never trust... values coming from the client".

export const UserRole = ["passenger", "driver", "admin"] as const
export type UserRole = (typeof UserRole)[number]

export const UserStatus = ["active", "suspended", "banned", "pending_verification"] as const
export type UserStatus = (typeof UserStatus)[number]

export const CityStatus = ["planned", "launching", "live", "paused"] as const
export type CityStatus = (typeof CityStatus)[number]

export const VerificationStatus = ["pending", "under_review", "approved", "rejected", "expired"] as const
export type VerificationStatus = (typeof VerificationStatus)[number]

export const AvailabilityStatus = ["offline", "online", "on_trip"] as const
export type AvailabilityStatus = (typeof AvailabilityStatus)[number]

export const BookingMode = ["quick_match", "competitive_offer"] as const
export type BookingMode = (typeof BookingMode)[number]

export const RideRequestStatus = ["searching", "offers_open", "matched", "expired", "cancelled"] as const
export type RideRequestStatus = (typeof RideRequestStatus)[number]

export const RideOfferStatus = ["pending", "accepted", "declined", "expired", "withdrawn"] as const
export type RideOfferStatus = (typeof RideOfferStatus)[number]

export const CounterOfferStatus = ["pending", "accepted", "expired", "withdrawn"] as const
export type CounterOfferStatus = (typeof CounterOfferStatus)[number]

// The full ride status flow required by Phase 2 §11, plus terminal/edge states.
export const RideStatus = [
  "driver_selected",
  "driver_arriving",
  "driver_arrived",
  "ride_started",
  "ride_completed",
  "cancelled_by_passenger",
  "cancelled_by_driver",
  "expired",
  "disputed",
] as const
export type RideStatus = (typeof RideStatus)[number]

export const PaymentMethod = ["cash", "card", "wallet", "local_provider"] as const
export type PaymentMethod = (typeof PaymentMethod)[number]

export const PaymentStatus = ["pending", "authorized", "captured", "failed", "refunded"] as const
export type PaymentStatus = (typeof PaymentStatus)[number]

export const TransactionType = [
  "ride_charge",
  "ride_payout",
  "commission",
  "wallet_topup",
  "withdrawal",
  "promo_credit",
  "adjustment",
  "refund",
  "incentive_bonus",
  "referral_reward",
] as const
export type TransactionType = (typeof TransactionType)[number]

export const NotificationType = ["ride_update", "offer_update", "promo", "system", "safety", "payment", "support"] as const
export type NotificationType = (typeof NotificationType)[number]

export const DiscountType = ["percentage", "flat"] as const
export type DiscountType = (typeof DiscountType)[number]

export const TicketStatus = ["open", "in_progress", "waiting", "resolved", "closed"] as const
export type TicketStatus = (typeof TicketStatus)[number]

export const SupportCategory = [
  "payment",
  "driver_issue",
  "passenger_issue",
  "lost_item",
  "cancellation",
  "pricing",
  "technical",
  "safety",
] as const
export type SupportCategory = (typeof SupportCategory)[number]

export const TicketPriority = ["low", "medium", "high", "urgent"] as const
export type TicketPriority = (typeof TicketPriority)[number]

export const DisputeStatus = ["open", "under_review", "awaiting_info", "resolved", "rejected", "closed"] as const
export type DisputeStatus = (typeof DisputeStatus)[number]

export const SafetyEventType = ["sos", "trip_shared", "report_filed", "suspicious_activity", "ride_deviation"] as const
export type SafetyEventType = (typeof SafetyEventType)[number]

export const SafetySeverity = ["low", "medium", "high", "critical"] as const
export type SafetySeverity = (typeof SafetySeverity)[number]

export const AdminRole = [
  "super_admin",
  "ops_manager",
  "support_agent",
  "finance",
  "safety_officer",
  "read_only",
  // Phase 4 §24
  "city_admin",
  "marketing",
] as const
export type AdminRole = (typeof AdminRole)[number]

export const VehicleStatus = ["pending", "active", "inactive", "rejected"] as const
export type VehicleStatus = (typeof VehicleStatus)[number]

export const DocType = [
  "national_id",
  "driving_license",
  "vehicle_registration",
  "insurance",
  "route_permit",
  "profile_photo",
] as const
export type DocType = (typeof DocType)[number]

/// Valid forward transitions for a Ride's status — the server-side state
/// machine referenced throughout Phase 2 §11. Cancellation states are
/// reachable from any non-terminal state (handled separately in the
/// ride status service, not encoded here, since cancellation is not a
/// "forward" transition).
export const RIDE_STATUS_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  driver_selected: ["driver_arriving", "cancelled_by_passenger", "cancelled_by_driver", "expired"],
  driver_arriving: ["driver_arrived", "cancelled_by_passenger", "cancelled_by_driver"],
  driver_arrived: ["ride_started", "cancelled_by_passenger", "cancelled_by_driver"],
  ride_started: ["ride_completed", "disputed"],
  ride_completed: ["disputed"],
  cancelled_by_passenger: [],
  cancelled_by_driver: [],
  expired: [],
  disputed: [],
}

export const TERMINAL_RIDE_STATUSES: RideStatus[] = [
  "ride_completed",
  "cancelled_by_passenger",
  "cancelled_by_driver",
  "expired",
]

// ---------------------------------------------------------------------
// Phase 3 additions
// ---------------------------------------------------------------------

export const IncentiveCampaignStatus = ["draft", "active", "ended"] as const
export type IncentiveCampaignStatus = (typeof IncentiveCampaignStatus)[number]

export const IncentiveProgressStatus = ["in_progress", "completed", "rewarded"] as const
export type IncentiveProgressStatus = (typeof IncentiveProgressStatus)[number]

export const ReferralStatus = ["pending", "qualified", "rewarded", "rejected"] as const
export type ReferralStatus = (typeof ReferralStatus)[number]

export const ScheduledRideStatus = ["scheduled", "dispatched", "completed", "cancelled", "expired"] as const
export type ScheduledRideStatus = (typeof ScheduledRideStatus)[number]

export const BusinessEmployeeRole = ["owner", "member"] as const
export type BusinessEmployeeRole = (typeof BusinessEmployeeRole)[number]

export const RiskEventType = [
  "repeated_signup",
  "promo_abuse",
  "unusual_cancellation",
  "impossible_movement",
  "shared_identifier",
  "payment_failure",
  "abnormal_offer_behavior",
] as const
export type RiskEventType = (typeof RiskEventType)[number]

export const DisputeDecision = ["refund_passenger", "adjust_driver_payout", "no_action"] as const
export type DisputeDecision = (typeof DisputeDecision)[number]
