import { z } from "zod";
import { currencySchema, moneySchema, weightGramsSchema } from "../../../lib/money.js";
import {
  isTestSku,
  METALS,
  skuSchema,
  STOCK_STATUSES,
  stockConsistencyError,
  type Metal,
  type StockStatus,
} from "../../../schemas/product.js";
import type { ImportIssue, ParsedRow } from "./parseCsv.js";

/**
 * Stage 3 + 4: per-row Zod validation, then whole-file checks (duplicate
 * SKUs, TEST- SKU protection). Validation is all-or-nothing — callers must
 * not write anything if `issues` is non-empty.
 */

/** A validated row. null = "not provided in this file". */
export interface ProductImportRecord {
  rowNumber: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  collection: string | null;
  metal: Metal | null;
  karat: number | null;
  weightGrams: string | null;
  makingCharge: string | null;
  stoneCost: string | null;
  approvedPrice: string | null;
  currency: string | null;
  stockQuantity: number | null;
  stockStatus: StockStatus | null;
  size: string | null;
  websiteUrl: string | null;
  isActive: boolean | null;
}

const nullable = <S extends z.ZodType>(schema: S) => z.union([z.null(), schema]);
const enumToken = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

const rowSchema = z.object({
  sku: skuSchema,
  name: z.string().min(1, "Name is required").max(200),
  description: nullable(z.string().max(5000)),
  category: nullable(z.string().max(100)),
  collection: nullable(z.string().max(100)),
  metal: nullable(z.string().transform(enumToken).pipe(z.enum(METALS))),
  karat: nullable(
    z
      .string()
      .regex(/^\d{1,2}\s*[kK]?$/, "Karat must be a whole number such as 22 or 22K")
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1, "Karat must be between 1 and 24").max(24, "Karat must be between 1 and 24")),
  ),
  weight_grams: nullable(weightGramsSchema("weight_grams")),
  making_charge: nullable(moneySchema("making_charge")),
  stone_cost: nullable(moneySchema("stone_cost")),
  approved_price: nullable(moneySchema("approved_price")),
  currency: nullable(currencySchema),
  stock_quantity: nullable(
    z
      .string()
      .regex(/^\d+$/, "stock_quantity must be a whole number ≥ 0")
      .transform(Number)
      .pipe(z.number().int().max(1_000_000)),
  ),
  stock_status: nullable(z.string().transform(enumToken).pipe(z.enum(STOCK_STATUSES))),
  size: nullable(z.string().max(50)),
  website_url: nullable(z.url({ protocol: /^https?$/, message: "website_url must be an http(s) URL" })),
  is_active: nullable(
    z
      .string()
      .transform((s) => s.toLowerCase())
      .pipe(z.enum(["true", "false", "yes", "no", "1", "0"]))
      .transform((s) => s === "true" || s === "yes" || s === "1"),
  ),
});

export interface ValidateOptions {
  allowTestSkus: boolean;
}

export interface ValidationOutcome {
  records: ProductImportRecord[];
  issues: ImportIssue[];
}

export function validateImportRows(rows: readonly ParsedRow[], options: ValidateOptions): ValidationOutcome {
  const issues: ImportIssue[] = [];
  const records: ProductImportRecord[] = [];

  for (const row of rows) {
    const result = rowSchema.safeParse(row.cells);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const column = issue.path[0] === undefined ? null : String(issue.path[0]);
        const message = issue.code === "invalid_union" ? `Invalid value for ${column}` : issue.message;
        issues.push({ row: row.rowNumber, column, message });
      }
      continue;
    }
    const v = result.data;
    const consistency = stockConsistencyError(v.stock_status, v.stock_quantity);
    if (consistency) issues.push({ row: row.rowNumber, column: "stock_status", message: consistency });
    if (!options.allowTestSkus && isTestSku(v.sku)) {
      issues.push({
        row: row.rowNumber,
        column: "sku",
        message: "TEST- SKUs are blocked; they are test fixtures and must not enter the real catalogue",
      });
    }
    records.push({
      rowNumber: row.rowNumber,
      sku: v.sku,
      name: v.name,
      description: v.description,
      category: v.category,
      collection: v.collection,
      metal: v.metal,
      karat: v.karat,
      weightGrams: v.weight_grams,
      makingCharge: v.making_charge,
      stoneCost: v.stone_cost,
      approvedPrice: v.approved_price,
      currency: v.currency,
      stockQuantity: v.stock_quantity,
      stockStatus: v.stock_status,
      size: v.size,
      websiteUrl: v.website_url,
      isActive: v.is_active,
    });
  }

  // Duplicate SKU detection (after normalization, so "zj-br-001" and
  // "ZJ-BR-001" are recognised as the same product).
  const bySku = new Map<string, number[]>();
  for (const r of records) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r.rowNumber]);
  for (const [sku, rowNumbers] of bySku) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      issues.push({
        row: rowNumber,
        column: "sku",
        message: `Duplicate SKU ${sku} appears on rows ${rowNumbers.join(", ")}`,
      });
    }
  }

  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { records, issues };
}
