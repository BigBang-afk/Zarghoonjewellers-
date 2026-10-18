import type { ExternalIdentityType } from "../lib/identifiers.js";
import type { LeadClassification } from "../services/crm/leadScoring.js";
import type { ActorType } from "../types/context.js";

/** Shared CRM vocabulary, domain types and snake_case → camelCase row mappers. */

export const LANGUAGES = ["english", "urdu", "roman_urdu", "unknown"] as const;
export type Language = (typeof LANGUAGES)[number];

export const CHANNELS = ["website", "whatsapp", "instagram", "facebook", "in_store", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

// --- Customers ---------------------------------------------------------------

export interface ExternalIdentity {
  type: ExternalIdentityType;
  value: string;
  isVerified: boolean;
}

export interface Customer {
  id: string;
  fullName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  city: string | null;
  preferredLanguage: Language;
  notes: string | null;
  lastContactAt: Date | null;
  doNotContact: boolean;
  doNotContactAt: Date | null;
  /** Messaging consent recorded by staff. "unknown" blocks automated outreach. */
  contactConsent: ContactConsent;
  contactConsentAt: Date | null;
  contactConsentSource: string | null;
  /** Set when identity matching is in doubt; blocks automated outreach until resolved. */
  identityReviewRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const CONTACT_CONSENTS = ["unknown", "granted", "denied"] as const;
export type ContactConsent = (typeof CONTACT_CONSENTS)[number];

export interface CustomerRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  city: string | null;
  preferred_language: Language;
  notes: string | null;
  last_contact_at: Date | null;
  do_not_contact: boolean;
  do_not_contact_at: Date | null;
  contact_consent: ContactConsent;
  contact_consent_at: Date | null;
  contact_consent_source: string | null;
  identity_review_required: boolean;
  created_at: Date;
  updated_at: Date;
}

export function mapCustomerRow(r: CustomerRow): Customer {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    whatsappNumber: r.whatsapp_number,
    email: r.email,
    city: r.city,
    preferredLanguage: r.preferred_language,
    notes: r.notes,
    lastContactAt: r.last_contact_at,
    doNotContact: r.do_not_contact,
    doNotContactAt: r.do_not_contact_at,
    contactConsent: r.contact_consent,
    contactConsentAt: r.contact_consent_at,
    contactConsentSource: r.contact_consent_source,
    identityReviewRequired: r.identity_review_required,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// --- Leads ---------------------------------------------------------------------

export const LEAD_STATUSES = [
  "new",
  "qualified",
  "warm",
  "hot",
  "very_hot",
  "waiting_customer",
  "human_followup",
  "won",
  "lost",
  "do_not_contact",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Terminal statuses: the lead is closed and no further sales activity applies. */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = ["won", "lost", "do_not_contact"];
export const isTerminalLeadStatus = (s: LeadStatus) => TERMINAL_LEAD_STATUSES.includes(s);

export interface Lead {
  id: string;
  customerId: string;
  status: LeadStatus;
  score: number;
  scoreClassification: LeadClassification;
  sourceChannel: Channel | null;
  budgetAmount: string | null;
  budgetCurrency: string | null;
  assignedStaffId: string | null;
  notes: string | null;
  lostReason: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadRow {
  id: string;
  customer_id: string;
  status: LeadStatus;
  score: number;
  score_classification: LeadClassification;
  source_channel: Channel | null;
  budget_amount: string | null;
  budget_currency: string | null;
  assigned_staff_id: string | null;
  notes: string | null;
  lost_reason: string | null;
  won_at: Date | null;
  lost_at: Date | null;
  last_activity_at: Date;
  created_at: Date;
  updated_at: Date;
}

export function mapLeadRow(r: LeadRow): Lead {
  return {
    id: r.id,
    customerId: r.customer_id,
    status: r.status,
    score: r.score,
    scoreClassification: r.score_classification,
    sourceChannel: r.source_channel,
    budgetAmount: r.budget_amount,
    budgetCurrency: r.budget_currency,
    assignedStaffId: r.assigned_staff_id,
    notes: r.notes,
    lostReason: r.lost_reason,
    wonAt: r.won_at,
    lostAt: r.lost_at,
    lastActivityAt: r.last_activity_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// --- Product interests -----------------------------------------------------------

export const INTEREST_TYPES = [
  "viewed",
  "asked_price",
  "asked_availability",
  "shortlisted",
  "requested_similar",
  "requested_customization",
] as const;
export type InterestType = (typeof INTEREST_TYPES)[number];

export interface ProductInterest {
  id: string;
  customerId: string;
  leadId: string | null;
  productId: string;
  productSku: string;
  productName: string;
  interestType: InterestType;
  conversationId: string | null;
  messageId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface ProductInterestRow {
  id: string;
  customer_id: string;
  lead_id: string | null;
  product_id: string;
  product_sku: string;
  product_name: string;
  interest_type: InterestType;
  conversation_id: string | null;
  message_id: string | null;
  notes: string | null;
  created_at: Date;
}

export function mapProductInterestRow(r: ProductInterestRow): ProductInterest {
  return {
    id: r.id,
    customerId: r.customer_id,
    leadId: r.lead_id,
    productId: r.product_id,
    productSku: r.product_sku,
    productName: r.product_name,
    interestType: r.interest_type,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

// --- Conversations & messages ------------------------------------------------------

export type ConversationStatus = "open" | "closed";

export interface Conversation {
  id: string;
  customerId: string | null;
  leadId: string | null;
  channel: Channel;
  externalConversationId: string | null;
  status: ConversationStatus;
  humanTakeover: boolean;
  humanTakeoverAt: Date | null;
  humanTakeoverReason: string | null;
  assignedStaffId: string | null;
  lastMessageAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationRow {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  channel: Channel;
  external_conversation_id: string | null;
  status: ConversationStatus;
  human_takeover: boolean;
  human_takeover_at: Date | null;
  human_takeover_reason: string | null;
  assigned_staff_id: string | null;
  last_message_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function mapConversationRow(r: ConversationRow): Conversation {
  return {
    id: r.id,
    customerId: r.customer_id,
    leadId: r.lead_id,
    channel: r.channel,
    externalConversationId: r.external_conversation_id,
    status: r.status,
    humanTakeover: r.human_takeover,
    humanTakeoverAt: r.human_takeover_at,
    humanTakeoverReason: r.human_takeover_reason,
    assignedStaffId: r.assigned_staff_id,
    lastMessageAt: r.last_message_at,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const SENDER_TYPES = ["customer", "ai", "staff", "system"] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: SenderType;
  senderStaffId: string | null;
  content: string;
  language: Language | null;
  metadata: Record<string, unknown>;
  externalMessageId: string | null;
  createdAt: Date;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: SenderType;
  sender_staff_id: string | null;
  content: string;
  language: Language | null;
  metadata: Record<string, unknown>;
  external_message_id: string | null;
  created_at: Date;
}

export function mapMessageRow(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    senderType: r.sender_type,
    senderStaffId: r.sender_staff_id,
    content: r.content,
    language: r.language,
    metadata: r.metadata,
    externalMessageId: r.external_message_id,
    createdAt: r.created_at,
  };
}

// --- Follow-ups -------------------------------------------------------------------

export const FOLLOWUP_STATUSES = ["pending", "completed", "cancelled", "skipped"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_TYPES = ["sales", "after_sales", "order_update", "service", "other"] as const;
export type FollowupType = (typeof FOLLOWUP_TYPES)[number];

export const FOLLOWUP_PURPOSES = [
  "new_inquiry",
  "product_interest",
  "bridal",
  "price_inquiry",
  "availability_inquiry",
  "visit_request",
  "custom_order",
  "staff_callback",
  "post_purchase_care",
  "review_request",
] as const;
export type FollowupPurpose = (typeof FOLLOWUP_PURPOSES)[number];
export const FOLLOWUP_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FollowupPriority = (typeof FOLLOWUP_PRIORITIES)[number];
export const PROCESSING_STATES = ["scheduled", "processing", "awaiting_review", "approved", "reminder_due", "blocked", "failed"] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export interface Followup {
  id: string;
  customerId: string;
  leadId: string | null;
  conversationId: string | null;
  assignedStaffId: string | null;
  followupType: FollowupType;
  channel: Channel | null;
  scheduledFor: Date;
  status: FollowupStatus;
  messageDraft: string | null;
  note: string | null;
  outcomeNote: string | null;
  createdByType: ActorType;
  createdByStaffId: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Follow-up engine fields (null/defaults for follow-ups created before Step 9). */
  purpose: FollowupPurpose | null;
  priority: FollowupPriority;
  productId: string | null;
  enrollmentId: string | null;
  sequenceStep: number | null;
  processingState: ProcessingState;
  processingAttempts: number;
  lastProcessedAt: Date | null;
  lastErrorCode: string | null;
  blockedReason: string | null;
  quietHoursAdjusted: boolean;
  customerRepliedAt: Date | null;
  replyAcknowledgedAt: Date | null;
}

export interface FollowupRow {
  id: string;
  customer_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  assigned_staff_id: string | null;
  followup_type: FollowupType;
  channel: Channel | null;
  scheduled_for: Date;
  status: FollowupStatus;
  message_draft: string | null;
  note: string | null;
  outcome_note: string | null;
  created_by_type: ActorType;
  created_by_staff_id: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  purpose: FollowupPurpose | null;
  priority: FollowupPriority;
  product_id: string | null;
  enrollment_id: string | null;
  sequence_step: number | null;
  processing_state: ProcessingState;
  processing_attempts: number;
  last_processed_at: Date | null;
  last_error_code: string | null;
  blocked_reason: string | null;
  quiet_hours_adjusted: boolean;
  customer_replied_at: Date | null;
  reply_acknowledged_at: Date | null;
}

export function mapFollowupRow(r: FollowupRow): Followup {
  return {
    id: r.id,
    customerId: r.customer_id,
    leadId: r.lead_id,
    conversationId: r.conversation_id,
    assignedStaffId: r.assigned_staff_id,
    followupType: r.followup_type,
    channel: r.channel,
    scheduledFor: r.scheduled_for,
    status: r.status,
    messageDraft: r.message_draft,
    note: r.note,
    outcomeNote: r.outcome_note,
    createdByType: r.created_by_type,
    createdByStaffId: r.created_by_staff_id,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    purpose: r.purpose,
    priority: r.priority,
    productId: r.product_id,
    enrollmentId: r.enrollment_id,
    sequenceStep: r.sequence_step,
    processingState: r.processing_state,
    processingAttempts: r.processing_attempts,
    lastProcessedAt: r.last_processed_at,
    lastErrorCode: r.last_error_code,
    blockedReason: r.blocked_reason,
    quietHoursAdjusted: r.quiet_hours_adjusted,
    customerRepliedAt: r.customer_replied_at,
    replyAcknowledgedAt: r.reply_acknowledged_at,
  };
}

// --- Handoffs ---------------------------------------------------------------------

export const HANDOFF_REASONS = [
  "customer_requested",
  "discount_request",
  "complaint",
  "payment_issue",
  "custom_order",
  "high_value_lead",
  "low_ai_confidence",
  "manager_requested",
  "other",
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];
export const HANDOFF_URGENCIES = ["normal", "high", "urgent"] as const;
export type HandoffUrgency = (typeof HANDOFF_URGENCIES)[number];

export interface Handoff {
  id: string;
  conversationId: string;
  customerId: string | null;
  leadId: string | null;
  reason: HandoffReason;
  urgency: HandoffUrgency;
  status: "open" | "resolved";
  note: string | null;
  requestedByType: ActorType;
  requestedByStaffId: string | null;
  assignedStaffId: string | null;
  resolvedAt: Date | null;
  resolvedByStaffId: string | null;
  createdAt: Date;
}

export interface HandoffRow {
  id: string;
  conversation_id: string;
  customer_id: string | null;
  lead_id: string | null;
  reason: HandoffReason;
  urgency: HandoffUrgency;
  status: "open" | "resolved";
  note: string | null;
  requested_by_type: ActorType;
  requested_by_staff_id: string | null;
  assigned_staff_id: string | null;
  resolved_at: Date | null;
  resolved_by_staff_id: string | null;
  created_at: Date;
}

export function mapHandoffRow(r: HandoffRow): Handoff {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    customerId: r.customer_id,
    leadId: r.lead_id,
    reason: r.reason,
    urgency: r.urgency,
    status: r.status,
    note: r.note,
    requestedByType: r.requested_by_type,
    requestedByStaffId: r.requested_by_staff_id,
    assignedStaffId: r.assigned_staff_id,
    resolvedAt: r.resolved_at,
    resolvedByStaffId: r.resolved_by_staff_id,
    createdAt: r.created_at,
  };
}
