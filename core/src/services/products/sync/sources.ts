import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { Db } from "../../../database/db.js";
import type { Metal } from "../../../schemas/product.js";
import type { SourceBatch } from "./sourceProduct.js";

/**
 * Product source adapters. Each converts one external system's data into
 * SourceProduct records WITHOUT inventing values: anything the source does
 * not state is null and is reported as a warning where useful.
 */

// --- The repository's Zarghoon website (Prisma "Product" table) ----------------------

/**
 * Deterministic mapping of the website's "quality" options to metal + karat.
 * Anything not in this table maps to unknown (null) with a warning.
 */
export const WEBSITE_QUALITY_MAP: Record<string, { metal: Metal; karat: number | null }> = {
  "24K Gold (999)": { metal: "gold", karat: 24 },
  "22K Gold (916)": { metal: "gold", karat: 22 },
  "18K Gold (750)": { metal: "gold", karat: 18 },
  "14K Gold (585)": { metal: "gold", karat: 14 },
  "Silver (925)": { metal: "silver", karat: null },
  "Platinum (950)": { metal: "platinum", karat: null },
};

/** Converts a float weight as stored by the website to an exact 3-dp string, or null if it isn't one. */
export function floatWeightToDecimal(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 1000) / 1000;
  // Only accept values whose float noise is negligible (what the admin actually typed).
  if (Math.abs(rounded - value) > 1e-9) return null;
  return rounded.toFixed(3);
}

interface WebsiteProductRow {
  id: string;
  name: string;
  category: string;
  quality: string;
  netWeight: number;
  wastagePercent: number;
  grossWeight: number;
  image_urls: string[] | null;
}

/**
 * Reads the website's own product table (read-only). Use a read-only database
 * role for WEBSITE_DATABASE_URL.
 *
 * Mapping decisions:
 *  - weight = netWeight (the metal weight the admin entered). grossWeight is
 *    net + wastage %, a pricing construct, so it is NOT used as a weight.
 *  - The website stores no SKU, price, stock, description or product URL:
 *    those stay null (SKUs come only from an approved mapping file).
 */
export async function readWebsitePrismaProducts(websiteDb: Db): Promise<SourceBatch> {
  const rows = await websiteDb.query<WebsiteProductRow>(
    `select p.id, p.name, p.category, p.quality, p."netWeight", p."wastagePercent", p."grossWeight",
            array_remove(array_agg(i.url order by i.id), null) as image_urls
       from "Product" p left join "ProductImage" i on i."productId" = p.id
      group by p.id order by p."createdAt", p.id`,
  );
  const warnings: Record<string, string[]> = {};
  const note = (id: string, w: string) => (warnings[id] ??= []).push(w);

  const records = rows.map((r) => {
    const quality = WEBSITE_QUALITY_MAP[r.quality.trim()];
    if (!quality) note(r.id, `Unrecognised quality "${r.quality}": metal and karat left unknown`);
    const weight = floatWeightToDecimal(r.netWeight);
    if (r.netWeight && !weight) note(r.id, `Net weight ${r.netWeight} is not an exact 3-decimal value: left unknown`);
    const images = (r.image_urls ?? []).filter((u) => u.startsWith("https://"));
    if ((r.image_urls?.length ?? 0) > images.length) note(r.id, "Non-HTTPS image URLs were skipped");
    note(r.id, "Website stores no price, stock or SKU: price and stock stay unknown");
    return {
      sourceProductId: r.id,
      sku: null,
      name: r.name,
      category: r.category,
      metal: quality?.metal ?? null,
      karat: quality?.karat ?? null,
      weightGrams: weight,
      imageUrls: images,
    };
  });
  return { source: "website_prisma", records, warnings };
}

// --- A JSON export (any platform, already converted to SourceProduct shape) ----------

export function readJsonProductFile(path: string, source = "website_export"): SourceBatch {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data)) throw new Error("Product file must contain a JSON array");
  return { source, records: data, warnings: {} };
}

// --- Approved SKU mapping (source product id → SKU) -----------------------------------

/**
 * CSV with columns `source_product_id,sku`, prepared and approved by the
 * owner. This is the only way products without a source SKU get one.
 */
export function readSkuMapCsv(path: string): Map<string, string> {
  const rows = parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = row.source_product_id;
    const sku = row.sku;
    if (!id || !sku) throw new Error("SKU map rows need source_product_id and sku");
    if (map.has(id)) throw new Error(`SKU map lists ${id} twice`);
    map.set(id, sku);
  }
  return map;
}
