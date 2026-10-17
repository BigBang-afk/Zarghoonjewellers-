import { readFileSync } from "node:fs";
import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
import { zodIssues } from "../lib/validation.js";

/**
 * Owner-approved store facts the Sales Agent may quote (address, hours…).
 *
 * These are business facts like prices: the model must never invent them.
 * Every field defaults to null, which the agent must treat as "needs
 * confirmation". Values come only from a JSON file the owner maintains,
 * pointed to by BUSINESS_INFO_PATH.
 */

const text = z.string().trim().min(1).max(500);

export const businessInfoSchema = z
  .object({
    businessName: text.default("Zarghoon Jewellers"),
    address: text.nullable().default(null),
    city: text.nullable().default(null),
    googleMapsUrl: z.url().nullable().default(null),
    phone: text.nullable().default(null),
    whatsappNumber: text.nullable().default(null),
    openingHours: text.nullable().default(null),
    websiteUrl: z.url().nullable().default(null),
    /** How customers place orders, in the owner's words. */
    orderProcess: text.nullable().default(null),
    /** Accepted payment methods, in the owner's words. */
    paymentMethods: text.nullable().default(null),
    /** Set only for demo fixtures, so demo facts can never be mistaken for real ones. */
    isDemo: z.boolean().default(false),
  })
  .strict();

export type BusinessInfo = z.infer<typeof businessInfoSchema>;

export const UNCONFIGURED_BUSINESS_INFO: BusinessInfo = businessInfoSchema.parse({});

export function loadBusinessInfo(source: NodeJS.ProcessEnv = process.env): BusinessInfo {
  const path = source.BUSINESS_INFO_PATH;
  if (!path) return UNCONFIGURED_BUSINESS_INFO;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ValidationError("BUSINESS_INFO_PATH could not be read as JSON");
  }
  const result = businessInfoSchema.safeParse(raw);
  if (!result.success) throw new ValidationError("Invalid business info file", zodIssues(result.error));
  if (result.data.isDemo && source.NODE_ENV === "production") {
    throw new ValidationError("Demo business info must not be used in production");
  }
  return result.data;
}
