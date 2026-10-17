import type { BusinessInfo } from "../config/businessInfo.js";
import type { Db } from "../database/db.js";
import { DEMO_SKU_PREFIX } from "../schemas/product.js";

/**
 * Demo fixtures for tests and the sales playground.
 *
 * Every product SKU starts with DEMO- and every name says so, so demo data is
 * unmistakable. The product importer blocks DEMO- SKUs like TEST- SKUs, and
 * `seedDemoData` refuses to run against a database that already holds real
 * products. Prices here are invented for demonstration only.
 */

export { DEMO_SKU_PREFIX };

export interface DemoProduct {
  sku: string;
  name: string;
  description: string;
  category: string;
  collection: string;
  metal: string;
  karat: number | null;
  weightGrams: string | null;
  approvedPrice: string | null;
  stockQuantity: number | null;
  stockStatus: string | null;
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    sku: "DEMO-NK-001",
    name: "DEMO Bridal Kundan Necklace Set",
    description: "Demo item: kundan bridal necklace set with matching earrings.",
    category: "necklace",
    collection: "bridal",
    metal: "gold",
    karat: 22,
    weightGrams: "62.500",
    approvedPrice: "485000.00",
    stockQuantity: 2,
    stockStatus: "available",
  },
  {
    sku: "DEMO-NK-002",
    name: "DEMO Bridal Polki Necklace",
    description: "Demo item: polki bridal necklace. Price and stock not yet confirmed.",
    category: "necklace",
    collection: "bridal",
    metal: "gold",
    karat: 22,
    weightGrams: null,
    approvedPrice: null,
    stockQuantity: null,
    stockStatus: null,
  },
  {
    sku: "DEMO-NK-003",
    name: "DEMO Rani Haar Bridal Necklace",
    description: "Demo item: long layered rani haar.",
    category: "necklace",
    collection: "bridal",
    metal: "gold",
    karat: 22,
    weightGrams: "95.000",
    approvedPrice: "720000.00",
    stockQuantity: 0,
    stockStatus: "out_of_stock",
  },
  {
    sku: "DEMO-BG-001",
    name: "DEMO Classic 22K Gold Bangles (Pair)",
    description: "Demo item: plain polished bangles for daily wear.",
    category: "bangle",
    collection: "daily wear",
    metal: "gold",
    karat: 22,
    weightGrams: "38.000",
    approvedPrice: "365000.00",
    stockQuantity: 4,
    stockStatus: "available",
  },
  {
    sku: "DEMO-BG-002",
    name: "DEMO 21K Kangan Bangle",
    description: "Demo item: single engraved kangan.",
    category: "bangle",
    collection: "daily wear",
    metal: "gold",
    karat: 21,
    weightGrams: "30.000",
    approvedPrice: "298000.00",
    stockQuantity: 1,
    stockStatus: "low_stock",
  },
  {
    sku: "DEMO-RG-001",
    name: "DEMO Solitaire Engagement Ring",
    description: "Demo item: white gold solitaire ring, made to order.",
    category: "ring",
    collection: "engagement",
    metal: "white_gold",
    karat: 18,
    weightGrams: "4.200",
    approvedPrice: "275000.00",
    stockQuantity: null,
    stockStatus: "made_to_order",
  },
  {
    sku: "DEMO-BR-001",
    name: "DEMO Gold Link Bracelet",
    description: "Demo item: link bracelet, currently reserved for another customer.",
    category: "bracelet",
    collection: "daily wear",
    metal: "gold",
    karat: 21,
    weightGrams: "14.000",
    approvedPrice: "145000.00",
    stockQuantity: 1,
    stockStatus: "reserved",
  },
  {
    sku: "DEMO-ER-001",
    name: "DEMO Gold Jhumka Earrings",
    description: "Demo item: traditional jhumkas.",
    category: "earrings",
    collection: "festive",
    metal: "gold",
    karat: 22,
    weightGrams: "11.000",
    approvedPrice: "98000.00",
    stockQuantity: 3,
    stockStatus: "available",
  },
];

export const DEMO_BUSINESS_INFO: BusinessInfo = {
  businessName: "Zarghoon Jewellers (DEMO)",
  address: "DEMO ADDRESS — 1 Example Road, Lahore (not a real address)",
  city: "Lahore",
  googleMapsUrl: null,
  phone: null,
  whatsappNumber: null,
  openingHours: "DEMO HOURS — Monday to Saturday, 11am to 9pm",
  websiteUrl: null,
  orderProcess: "DEMO — Visit the store or ask our team to reserve a piece; staff confirm every order personally.",
  paymentMethods: null,
  isDemo: true,
};

export interface DemoSeedResult {
  productIds: Record<string, string>;
  staffId: string;
}

/** Seeds demo staff and products. Refuses to touch a database that holds non-demo products. */
export async function seedDemoData(db: Db): Promise<DemoSeedResult> {
  const real = await db.query<{ n: number }>(
    `select count(*)::int as n from products where sku not like $1`,
    [`${DEMO_SKU_PREFIX}%`],
  );
  if (real[0]!.n > 0) {
    throw new Error("Refusing to seed demo data: this database already contains real (non-DEMO) products");
  }
  const productIds: Record<string, string> = {};
  for (const p of DEMO_PRODUCTS) {
    const rows = await db.query<{ id: string }>(
      `insert into products (sku, name, description, category, collection, metal, karat, weight_grams,
                             approved_price, stock_quantity, stock_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (sku) do update set name = excluded.name
       returning id`,
      [p.sku, p.name, p.description, p.category, p.collection, p.metal, p.karat, p.weightGrams, p.approvedPrice, p.stockQuantity, p.stockStatus],
    );
    productIds[p.sku] = rows[0]!.id;
  }
  const staff = await db.query<{ id: string }>(
    `insert into staff (full_name, role, is_active, is_available, email)
     values ('DEMO Sales Manager', 'manager', true, true, 'demo.manager@example.invalid')
     on conflict (email) where email is not null do update set full_name = excluded.full_name
     returning id`,
  );
  return { productIds, staffId: staff[0]!.id };
}
