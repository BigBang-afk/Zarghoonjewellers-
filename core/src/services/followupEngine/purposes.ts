import type { FollowupPurpose, FollowupType } from "../../schemas/crm.js";

/**
 * What each follow-up purpose is. `outreach` purposes would eventually become
 * a message to the customer (drafted, staff-reviewed); `staff_callback` is an
 * internal reminder for staff only.
 */
export interface PurposeMeta {
  label: string;
  /** Stored followup_type (keeps the existing one-pending-per-type rule meaningful). */
  followupType: FollowupType;
  outreach: boolean;
  /** Part of the sales workflow: stops when the lead is won, lost or closed. */
  sales: boolean;
  /** Needs a confirmed (realized) order. */
  requiresPurchase: "none" | "realized" | "delivered";
}

export const PURPOSE_META: Record<FollowupPurpose, PurposeMeta> = {
  new_inquiry: { label: "New inquiry", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  product_interest: { label: "Product interest", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  bridal: { label: "Bridal customer", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  price_inquiry: { label: "Price inquiry", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  availability_inquiry: { label: "Availability inquiry", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  visit_request: { label: "Visit request", followupType: "sales", outreach: true, sales: true, requiresPurchase: "none" },
  custom_order: { label: "Custom order", followupType: "order_update", outreach: true, sales: true, requiresPurchase: "none" },
  staff_callback: { label: "Staff callback reminder", followupType: "other", outreach: false, sales: false, requiresPurchase: "none" },
  post_purchase_care: { label: "Post-purchase care", followupType: "after_sales", outreach: true, sales: false, requiresPurchase: "realized" },
  review_request: { label: "Review request", followupType: "service", outreach: true, sales: false, requiresPurchase: "delivered" },
};
