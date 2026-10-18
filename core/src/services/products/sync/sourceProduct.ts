import { z } from "zod";
import { currencySchema, moneySchema, weightGramsSchema } from "../../../lib/money.js";
import { METALS, skuSchema, STOCK_STATUSES } from "../../../schemas/product.js";

/**
 * The normalised shape every product source (the existing website's
 * database, a platform export…) is converted into before synchronisation.
 *
 * Every business fact is optional/nullable: a source that does not know a
 * value says null, and null is never turned into a guess.
 */

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .default(null);

export const sourceProductSchema = z
  .object({
    /** Stable id of the product in the source system. */
    sourceProductId: z.string().trim().min(1).max(200),
    /** SKU as recorded by the source. Missing SKUs are flagged, never generated. */
    sku: skuSchema.nullable().default(null),
    name: z.string().trim().min(1).max(200),
    description: nullableText(5000),
    category: nullableText(100).transform((c) => (c ? c.toLowerCase() : null)),
    collection: nullableText(100).transform((c) => (c ? c.toLowerCase() : null)),
    metal: z.enum(METALS).nullable().default(null),
    karat: z.number().int().min(1).max(24).nullable().default(null),
    weightGrams: weightGramsSchema("weightGrams").nullable().default(null),
    /** A price the source displays. Only fills an empty approved price; never overwrites one. */
    price: moneySchema("price").nullable().default(null),
    currency: currencySchema.nullable().default(null),
    /** Only explicit stock facts; absence means unknown — never "in stock". */
    stockQuantity: z.number().int().min(0).max(1_000_000).nullable().default(null),
    stockStatus: z.enum(STOCK_STATUSES).nullable().default(null),
    imageUrls: z.array(z.url({ protocol: /^https$/ })).max(20).default([]),
    productUrl: z.url({ protocol: /^https?$/ }).nullable().default(null),
  })
  .strict();

export type SourceProductInput = z.input<typeof sourceProductSchema>;
export type SourceProduct = z.output<typeof sourceProductSchema>;

/** A source as handed to the sync engine: a stable name + raw records + mapping notes. */
export interface SourceBatch {
  /** e.g. "website_prisma", "website_export". Used to link products across syncs. */
  source: string;
  records: unknown[];
  /** Notes from the adapter about lossy or ambiguous mappings, per source id. */
  warnings: Record<string, string[]>;
}
