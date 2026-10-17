/**
 * Typed error hierarchy.
 *
 * Business errors (a rule said "no") are distinguishable from infrastructure
 * errors (something broke). Only business errors expose their message and
 * details to callers; infrastructure errors are reduced to a generic message
 * by `toPublicError` so connection strings, SQL or stack traces never leak.
 */

export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "business_rule"
  | "forbidden"
  | "approval_required"
  | "infrastructure";

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly kind: ErrorKind;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
  }

  get isBusinessError(): boolean {
    return this.kind !== "infrastructure";
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED";
  readonly kind = "validation" as const;
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message, { issues });
  }
}

// --- Not found -------------------------------------------------------------

export class NotFoundError extends AppError {
  readonly kind = "not_found" as const;
  readonly code: string;
  constructor(entity: string, reference: string | Record<string, unknown>) {
    super(`${entity} not found`, { entity, reference });
    this.code = `${entity.toUpperCase()}_NOT_FOUND`;
  }
}

export class ProductNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("product", reference);
  }
}
export class CustomerNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("customer", reference);
  }
}
export class LeadNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("lead", reference);
  }
}
export class ConversationNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("conversation", reference);
  }
}
export class MessageNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("message", reference);
  }
}
export class FollowupNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("followup", reference);
  }
}
export class StaffNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("staff", reference);
  }
}
export class HandoffNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("handoff", reference);
  }
}
export class ApprovalNotFoundError extends NotFoundError {
  constructor(reference: string | Record<string, unknown>) {
    super("approval", reference);
  }
}

// --- Conflicts -------------------------------------------------------------

export interface IdentityMatch {
  identifier: "phone" | "whatsapp_number" | "email" | "external_identity";
  value: string;
  customerId: string;
}

/**
 * The supplied identifiers point at more than one existing customer.
 * Records are never merged automatically — a human must review.
 */
export class CustomerIdentityConflictError extends AppError {
  readonly code = "CUSTOMER_IDENTITY_CONFLICT";
  readonly kind = "conflict" as const;
  constructor(
    readonly customerIds: string[],
    readonly matches: IdentityMatch[],
  ) {
    super("Identifiers match more than one existing customer; manual review required", { customerIds, matches });
  }
}

export class ActiveLeadExistsError extends AppError {
  readonly code = "ACTIVE_LEAD_EXISTS";
  readonly kind = "conflict" as const;
  constructor(readonly customerId: string, readonly activeLeadId: string) {
    super("Customer already has an active lead", { customerId, activeLeadId });
  }
}

export class DuplicateLeadSignalError extends AppError {
  readonly code = "DUPLICATE_LEAD_SIGNAL";
  readonly kind = "conflict" as const;
  constructor(leadId: string, signal: string) {
    super(`Signal "${signal}" has already been recorded for this lead`, { leadId, signal });
  }
}

export class DuplicateFollowupError extends AppError {
  readonly code = "DUPLICATE_FOLLOWUP";
  readonly kind = "conflict" as const;
  constructor(readonly existingFollowupId: string | null) {
    super("A pending follow-up of this type already exists", { existingFollowupId });
  }
}

export class DuplicateConversationError extends AppError {
  readonly code = "DUPLICATE_CONVERSATION";
  readonly kind = "conflict" as const;
  constructor(channel: string, externalConversationId: string, readonly existingConversationId: string | null) {
    super("A conversation with this external ID already exists", {
      channel,
      externalConversationId,
      existingConversationId,
    });
  }
}

// --- Business rules --------------------------------------------------------

export class InvalidStateError extends AppError {
  readonly code = "INVALID_STATE";
  readonly kind = "business_rule" as const;
}

export type FollowupRejectionReason =
  | "scheduled_in_past"
  | "scheduled_too_far_ahead"
  | "do_not_contact"
  | "lead_closed"
  | "not_pending";

export class FollowupNotAllowedError extends AppError {
  readonly code = "FOLLOWUP_NOT_ALLOWED";
  readonly kind = "business_rule" as const;
  constructor(readonly reason: FollowupRejectionReason, message: string) {
    super(message, { reason });
  }
}

export class DoNotContactError extends AppError {
  readonly code = "DO_NOT_CONTACT";
  readonly kind = "business_rule" as const;
  constructor(customerId: string) {
    super("Customer has asked not to be contacted", { customerId });
  }
}

export class HumanTakeoverActiveError extends AppError {
  readonly code = "HUMAN_TAKEOVER_ACTIVE";
  readonly kind = "business_rule" as const;
  constructor(conversationId: string) {
    super("A human has taken over this conversation; autonomous replies are blocked", { conversationId });
  }
}

export class ConversationClosedError extends AppError {
  readonly code = "CONVERSATION_CLOSED";
  readonly kind = "business_rule" as const;
  constructor(conversationId: string) {
    super("Conversation is closed", { conversationId });
  }
}

export class StaffUnavailableError extends AppError {
  readonly code = "STAFF_UNAVAILABLE";
  readonly kind = "business_rule" as const;
  constructor(staffId: string, reason: "inactive" | "unavailable") {
    super(`Staff member is ${reason} and cannot be assigned`, { staffId, reason });
  }
}

export class ForbiddenActionError extends AppError {
  readonly code = "FORBIDDEN_ACTION";
  readonly kind = "forbidden" as const;
}

export class ApprovalRequiredError extends AppError {
  readonly code = "APPROVAL_REQUIRED";
  readonly kind = "approval_required" as const;
}

export class InvalidProductImportError extends AppError {
  readonly code = "INVALID_PRODUCT_IMPORT";
  readonly kind = "validation" as const;
}

// --- Infrastructure --------------------------------------------------------

export class InfrastructureError extends AppError {
  readonly code = "INFRASTRUCTURE_ERROR";
  readonly kind = "infrastructure" as const;
}

export interface PublicError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Converts any thrown value into a safe, client-facing error shape. */
export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError && error.isBusinessError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: "INTERNAL_ERROR", message: "An internal error occurred" };
}
