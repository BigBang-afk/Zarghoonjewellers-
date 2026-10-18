import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

/**
 * Identifier normalization. Customer matching only works if the same person's
 * phone/email always normalizes to the same string.
 */

/** Numbers without an international prefix are interpreted as Pakistani. */
export const DEFAULT_PHONE_REGION = "PK" as const;

/** Returns the E.164 form (e.g. +923001234567) or null if the input is not a valid phone number. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_PHONE_REGION);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return z.email().safeParse(email).success ? email : null;
}

export const EXTERNAL_IDENTITY_TYPES = [
  "website_visitor",
  "website_account",
  "instagram",
  "facebook",
  "tiktok",
  "google",
  "other",
] as const;
export type ExternalIdentityType = (typeof EXTERNAL_IDENTITY_TYPES)[number];

/**
 * Social handles are case-insensitive and often typed with a leading "@";
 * opaque platform IDs are only trimmed.
 */
export function normalizeExternalIdentity(type: ExternalIdentityType, raw: string): string | null {
  let value = raw.trim();
  if (type === "instagram" || type === "tiktok") {
    value = value.replace(/^@/, "").toLowerCase();
  }
  return value.length > 0 && value.length <= 255 ? value : null;
}

export const phoneSchema = z.string().transform((raw, ctx) => {
  const phone = normalizePhone(raw);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Invalid phone number" });
    return z.NEVER;
  }
  return phone;
});

export const emailSchema = z.string().transform((raw, ctx) => {
  const email = normalizeEmail(raw);
  if (!email) {
    ctx.addIssue({ code: "custom", message: "Invalid email address" });
    return z.NEVER;
  }
  return email;
});

export const externalIdentitySchema = z
  .object({ type: z.enum(EXTERNAL_IDENTITY_TYPES), value: z.string() })
  .transform((input, ctx) => {
    const value = normalizeExternalIdentity(input.type, input.value);
    if (!value) {
      ctx.addIssue({ code: "custom", message: "Invalid external identity value", path: ["value"] });
      return z.NEVER;
    }
    return { type: input.type, value };
  });
