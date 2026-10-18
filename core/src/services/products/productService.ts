import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { ProductNotFoundError } from "../../lib/errors.js";
import { moneySchema } from "../../lib/money.js";
import { parseInput, uuidSchema } from "../../lib/validation.js";
import {
  mapProductRow,
  skuSchema,
  STOCK_STATUSES,
  type Product,
  type ProductRow,
  type StockStatus,
} from "../../schemas/product.js";

/**
 * Read-only product intelligence. Every value returned comes straight from
 * the database; unknown facts are returned as null, never estimated.
 */

export interface ProductSearchResult extends Product {
  primaryImageUrl: string | null;
  /** "requires_confirmation" whenever approved_price is null. */
  priceStatus: "approved" | "requires_confirmation";
}

/**
 * Availability is derived deterministically from stored stock data.
 * `canPromiseInStock` is the only flag an agent may rely on to tell a
 * customer that a piece is in stock right now.
 */
export interface InventoryStatus {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  stockStatus: StockStatus | null;
  stockQuantity: number | null;
  availability: StockStatus | "unknown" | "not_listed";
  canPromiseInStock: boolean;
  requiresConfirmation: boolean;
}

export const productSearchSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    category: z.string().trim().max(100).optional(),
    collection: z.string().trim().max(100).optional(),
    karat: z.number().int().min(1).max(24).optional(),
    stockStatuses: z.array(z.enum(STOCK_STATUSES)).max(STOCK_STATUSES.length).optional(),
    /** Price filters only ever match products that HAVE an approved price. */
    minPrice: moneySchema("minPrice").optional(),
    maxPrice: moneySchema("maxPrice").optional(),
    includeInactive: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type ProductSearchInput = z.input<typeof productSearchSchema>;

const productRefSchema = z.union([
  z.object({ id: uuidSchema }).strict(),
  z.object({ sku: skuSchema }).strict(),
]);
export type ProductRef = z.input<typeof productRefSchema>;

/** Escapes LIKE wildcards so user text is matched literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createProductService(db: Db) {
  async function getProductById(id: string): Promise<Product> {
    const productId = parseInput(uuidSchema, id, "product id");
    const row = await queryOne<ProductRow>(db, `select * from products where id = $1`, [productId]);
    if (!row) throw new ProductNotFoundError({ id: productId });
    return mapProductRow(row);
  }

  async function getProductBySku(sku: string): Promise<Product> {
    const normalized = parseInput(skuSchema, sku, "SKU");
    const row = await queryOne<ProductRow>(db, `select * from products where sku = $1`, [normalized]);
    if (!row) throw new ProductNotFoundError({ sku: normalized });
    return mapProductRow(row);
  }

  async function getProduct(ref: ProductRef): Promise<Product> {
    const parsed = parseInput(productRefSchema, ref, "product reference");
    return "id" in parsed ? getProductById(parsed.id) : getProductBySku(parsed.sku);
  }

  async function searchProducts(input: ProductSearchInput = {}): Promise<ProductSearchResult[]> {
    const f = parseInput(productSearchSchema, input, "product search");
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: (p: string) => string, value: unknown) => {
      params.push(value);
      where.push(clause(`$${params.length}`));
    };

    if (!f.includeInactive) where.push("p.is_active");
    if (f.query) {
      add(
        (p) =>
          `(p.name ilike ${p} or p.sku ilike ${p} or p.description ilike ${p} or p.category ilike ${p} or p.collection ilike ${p})`,
        likePattern(f.query),
      );
    }
    if (f.category) add((p) => `lower(p.category) = lower(${p})`, f.category);
    if (f.collection) add((p) => `lower(p.collection) = lower(${p})`, f.collection);
    if (f.karat !== undefined) add((p) => `p.karat = ${p}`, f.karat);
    if (f.stockStatuses?.length) add((p) => `p.stock_status = any(${p}::text[])`, f.stockStatuses);
    if (f.minPrice !== undefined) add((p) => `p.approved_price >= ${p}::numeric`, f.minPrice);
    if (f.maxPrice !== undefined) add((p) => `p.approved_price <= ${p}::numeric`, f.maxPrice);

    params.push(f.limit, f.offset);
    const rows = await db.query<ProductRow & { primary_image_url: string | null }>(
      `select p.*,
              (select i.url from product_images i where i.product_id = p.id
                order by i.is_primary desc, i.sort_order, i.created_at limit 1) as primary_image_url
         from products p
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by p.name, p.sku
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      ...mapProductRow(r),
      primaryImageUrl: r.primary_image_url,
      priceStatus: r.approved_price === null ? "requires_confirmation" : "approved",
    }));
  }

  async function checkInventory(ref: ProductRef): Promise<InventoryStatus> {
    const p = await getProduct(ref);
    const inStock = p.stockStatus === "available" || p.stockStatus === "low_stock";
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      isActive: p.isActive,
      stockStatus: p.stockStatus,
      stockQuantity: p.stockQuantity,
      availability: !p.isActive ? "not_listed" : (p.stockStatus ?? "unknown"),
      canPromiseInStock: p.isActive && inStock,
      requiresConfirmation: !p.isActive || p.stockStatus === null || p.stockStatus === "reserved",
    };
  }

  /** The product's primary catalogue image, or null. Only images stored against the product count. */
  async function getPrimaryImageUrl(productId: string): Promise<string | null> {
    const id = parseInput(uuidSchema, productId, "product id");
    const row = await queryOne<{ url: string }>(
      db,
      `select url from product_images where product_id = $1 order by is_primary desc, sort_order, created_at limit 1`,
      [id],
    );
    return row?.url ?? null;
  }

  return { getProductById, getProductBySku, getProduct, searchProducts, checkInventory, getPrimaryImageUrl };
}

export type ProductService = ReturnType<typeof createProductService>;
