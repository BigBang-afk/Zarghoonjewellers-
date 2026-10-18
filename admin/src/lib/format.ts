/**
 * Display helpers. Pure functions, safe on server and client.
 *
 * Money arrives as exact decimal strings from the database and is formatted
 * with string operations only — never converted to a float.
 */

export const TIMEZONE = "Asia/Karachi";
export const NEEDS_CONFIRMATION = "Needs confirmation";

/** "485000.00" → "PKR 485,000"; "1234.50" → "PKR 1,234.50"; null → null. */
export function formatMoney(amount: string | null | undefined, currency = "PKR"): string | null {
  if (amount === null || amount === undefined || !/^-?\d+(\.\d+)?$/.test(amount)) return null;
  const negative = amount.startsWith("-");
  const [int, frac = ""] = amount.replace("-", "").split(".");
  const grouped = int!.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${currency} ${grouped}${cents ? `.${frac.padEnd(2, "0").slice(0, 2)}` : ""}`;
}

/** "48.250" → "48.25 g". */
export function formatWeight(grams: string | null | undefined): string | null {
  if (!grams || !/^\d+(\.\d+)?$/.test(grams)) return null;
  return `${grams.includes(".") ? grams.replace(/\.?0+$/, "") : grams} g`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, dateStyle: "medium" });

export const formatDateTime = (d: Date | string | null | undefined) => (d ? dateTime.format(new Date(d)) : null);
export const formatDate = (d: Date | string | null | undefined) => (d ? dateOnly.format(new Date(d)) : null);

/** "Today 14:05", "3h ago", "in 2 days" — relative to `now`. */
export function formatRelative(d: Date | string | null | undefined, now: Date = new Date()): string | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  for (const [ms, unit] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
      return diff < 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return "just now";
}

export const humanize = (value: string | null | undefined) =>
  value ? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "";

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  warm: "Warm",
  hot: "Hot",
  very_hot: "Very hot",
  waiting_customer: "Waiting for customer",
  human_followup: "Human follow-up",
  won: "Won",
  lost: "Lost",
  do_not_contact: "Do not contact",
};

export const CLASSIFICATION_LABELS: Record<string, string> = { cold: "Cold", warm: "Warm", hot: "Hot", very_hot: "Very hot" };

export const SIGNAL_LABELS: Record<string, string> = {
  asked_price: "Asked about price",
  provided_budget: "Shared a budget",
  specific_product_interest: "Interested in a specific piece",
  asked_availability: "Asked about availability",
  provided_contact: "Shared contact details",
  asked_shop_location: "Asked for the shop location",
  asked_about_visit: "Asked about visiting",
  asked_about_payment_or_order: "Asked about payment or ordering",
  repeated_product_interest: "Repeated interest",
  requested_human_salesperson: "Asked for a salesperson",
};

export const HANDOFF_REASON_LABELS: Record<string, string> = {
  customer_requested: "Customer asked for a person",
  discount_request: "Discount request",
  complaint: "Complaint",
  payment_issue: "Payment issue",
  custom_order: "Custom order",
  high_value_lead: "High-value lead",
  low_ai_confidence: "AI unsure",
  manager_requested: "Manager requested",
  other: "Other",
};

export const STOCK_LABELS: Record<string, string> = {
  available: "Available",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  reserved: "Reserved",
  made_to_order: "Made to order",
  discontinued: "Discontinued",
};

export const SENDER_LABELS: Record<string, string> = { customer: "Customer", ai: "Zarghoon AI", staff: "Staff", system: "System" };

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** A `datetime-local` value ("2026-10-19T15:30") in the business time zone → UTC Date (null if malformed). */
export function zonedLocalToUtc(value: string, timeZone = TIMEZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

/** UTC Date → `datetime-local` value in the business time zone. */
export function utcToZonedLocal(date: Date, timeZone = TIMEZONE): string {
  return new Date(date.getTime() + zoneOffsetMs(date, timeZone)).toISOString().slice(0, 16);
}

/** Default for new follow-ups: tomorrow at 11:00 business time. */
export function defaultFollowupLocal(now: Date = new Date()): string {
  return `${utcToZonedLocal(new Date(now.getTime() + 24 * 3_600_000)).slice(0, 10)}T11:00`;
}

/** A fresh key for one form render, so a double-submitted form is processed once. */
export function newRequestKey(): string {
  return globalThis.crypto.randomUUID();
}
