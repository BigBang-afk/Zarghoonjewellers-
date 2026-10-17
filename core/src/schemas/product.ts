import { z } from "zod";

export const STOCK_STATUSES = [
  "available",
  "low_stock",
  "out_of_stock",
  "reserved",
  "made_to_order",
  "discontinued",
] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const METALS = ["gold", "white_gold", "rose_gold", "silver", "platinum", "other"] as const;
export type Metal = (typeof METALS)[number];

/** Uppercase alphanumeric segments joined by hyphens, e.g. ZJ-BR-001. */
export const SKU_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)+$/;
export const TEST_SKU_PREFIX = "TEST-";

export const skuSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().max(64, "SKU is too long").regex(SKU_PATTERN, "SKU must look like ZJ-BR-001"));

export function isTestSku(sku: string): boolean {
  return sku.toUpperCase().startsWith(TEST_SKU_PREFIX);
}

/**
 * A product exactly as stored. Every business fact is nullable because the
 * catalogue may not know it yet — unknown stays null, it is never guessed.
 * Money and weight are decimal strings.
 */
export interface Product {
  id: string;
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
  currency: string;
  stockQuantity: number | null;
  stockStatus: StockStatus | null;
  size: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  collection: string | null;
  metal: Metal | null;
  karat: number | null;
  weight_grams: string | null;
  making_charge: string | null;
  stone_cost: string | null;
  approved_price: string | null;
  currency: string;
  stock_quantity: number | null;
  stock_status: StockStatus | null;
  size: string | null;
  website_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export function mapProductRow(r: ProductRow): Product {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    category: r.category,
    collection: r.collection,
    metal: r.metal,
    karat: r.karat,
    weightGrams: r.weight_grams,
    makingCharge: r.making_charge,
    stoneCost: r.stone_cost,
    approvedPrice: r.approved_price,
    currency: r.currency,
    stockQuantity: r.stock_quantity,
    stockStatus: r.stock_status,
    size: r.size,
    websiteUrl: r.website_url,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Consistency between stock_status and stock_quantity (mirrors the
 * products_stock_consistency database constraint). Returns an error message
 * or null.
 */
export function stockConsistencyError(status: StockStatus | null, quantity: number | null): string | null {
  if (status === null || quantity === null) return null;
  if (status === "out_of_stock" && quantity !== 0) return "out_of_stock products must have stock_quantity 0";
  if ((status === "available" || status === "low_stock") && quantity === 0) {
    return `${status} products must have stock_quantity greater than 0`;
  }
  return null;
}
