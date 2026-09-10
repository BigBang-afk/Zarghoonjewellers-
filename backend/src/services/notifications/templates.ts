import { prisma } from "../../utils/prisma.js"

/**
 * Notification templates (Phase 4 §19) — admin-editable copy per
 * notification key + locale, backed by the `NotificationTemplate` table.
 * A key with no DB row (or no row for the requested locale) falls back
 * to the in-code English default below, so the system always has
 * something to say even before an admin ever touches this screen.
 *
 * `{{placeholder}}` tokens are replaced from the `vars` map given to
 * `renderTemplate` — unresolved tokens are left as-is rather than
 * throwing, so a template author's typo never breaks a real notification.
 */
export interface TemplateDefault {
  title: string
  body: string
}

/** English defaults + a starter Urdu pass for the highest-frequency ride-lifecycle events (Phase 4 §2/§19). */
export const DEFAULT_TEMPLATES: Record<string, Record<string, TemplateDefault>> = {
  "ride.driver_request": {
    en: { title: "New ride request", body: "Pickup {{pickup}} — Rs {{fare}}" },
    ur: { title: "نئی رائیڈ درخواست", body: "پک اپ {{pickup}} — روپے {{fare}}" },
  },
  "ride.offer_received": {
    en: { title: "Offer received", body: "{{count}} drivers are considering your request." },
    ur: { title: "پیشکش موصول ہوئی", body: "{{count}} ڈرائیورز آپ کی درخواست پر غور کر رہے ہیں۔" },
  },
  "ride.driver_selected": {
    en: { title: "Driver on the way", body: "{{driverName}} is arriving in {{etaMin}} minutes." },
    ur: { title: "ڈرائیور راستے میں ہے", body: "{{driverName}} {{etaMin}} منٹ میں پہنچ رہے ہیں۔" },
  },
  "ride.driver_arriving": {
    en: { title: "Your driver is arriving", body: "{{driverName}} is almost at the pickup point." },
    ur: { title: "آپ کا ڈرائیور پہنچ رہا ہے", body: "{{driverName}} پک اپ پوائنٹ کے قریب ہیں۔" },
  },
  "ride.driver_arrived": {
    en: { title: "Your driver has arrived", body: "{{driverName}} is waiting for you." },
    ur: { title: "آپ کا ڈرائیور پہنچ گیا", body: "{{driverName}} آپ کا انتظار کر رہے ہیں۔" },
  },
  "ride.started": {
    en: { title: "You're on your way", body: "Your ride to {{destination}} has started." },
    ur: { title: "آپ کا سفر شروع ہو گیا", body: "{{destination}} کی طرف آپ کا سفر شروع ہو گیا ہے۔" },
  },
  "ride.completed": {
    en: { title: "Ride completed", body: "Total fare: Rs {{fare}}. Thanks for riding with RIVO." },
    ur: { title: "رائیڈ مکمل ہو گئی", body: "کل کرایہ: روپے {{fare}}۔ RIVO کے ساتھ سفر کرنے کا شکریہ۔" },
  },
  "ride.cancelled_by_passenger": {
    en: { title: "Ride cancelled", body: "The passenger cancelled this ride. {{reason}}" },
    ur: { title: "رائیڈ منسوخ ہو گئی", body: "مسافر نے یہ رائیڈ منسوخ کر دی۔ {{reason}}" },
  },
  "ride.cancelled_by_driver": {
    en: { title: "Ride cancelled", body: "The driver cancelled this ride. {{reason}}" },
    ur: { title: "رائیڈ منسوخ ہو گئی", body: "ڈرائیور نے یہ رائیڈ منسوخ کر دی۔ {{reason}}" },
  },
  "payment.captured": {
    en: { title: "Payment received", body: "Rs {{amount}} was charged for your ride." },
    ur: { title: "ادائیگی موصول ہوئی", body: "آپ کی رائیڈ کے لیے روپے {{amount}} کاٹے گئے۔" },
  },
  "promotion.applied": {
    en: { title: "Promo applied", body: "Rs {{discount}} off this ride." },
    ur: { title: "پرومو لاگو ہو گیا", body: "اس رائیڈ پر روپے {{discount}} کی رعایت۔" },
  },
  "referral.rewarded": {
    en: { title: "Referral reward!", body: "Rs {{amount}} added to your wallet." },
    ur: { title: "ریفرل انعام!", body: "آپ کے والیٹ میں روپے {{amount}} شامل کر دیے گئے۔" },
  },
  "support.ticket_update": {
    en: { title: "Support ticket update", body: "{{message}}" },
    ur: { title: "سپورٹ ٹکٹ اپڈیٹ", body: "{{message}}" },
  },
  "safety.alert": {
    en: { title: "Safety alert", body: "{{message}}" },
    ur: { title: "حفاظتی انتباہ", body: "{{message}}" },
  },
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

export async function renderTemplate(
  key: string,
  locale: string,
  vars: Record<string, string | number> = {},
): Promise<TemplateDefault> {
  const row =
    (await prisma.notificationTemplate.findUnique({ where: { key_locale: { key, locale } } })) ??
    (await prisma.notificationTemplate.findUnique({ where: { key_locale: { key, locale: "en" } } }))

  const fallback = DEFAULT_TEMPLATES[key]?.[locale] ?? DEFAULT_TEMPLATES[key]?.en ?? { title: key, body: "" }
  const source = row ?? fallback

  return { title: interpolate(source.title, vars), body: interpolate(source.body, vars) }
}
