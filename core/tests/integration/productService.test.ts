import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProductService } from "../../src/services/products/productService.js";
import { ProductNotFoundError, ValidationError } from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { insertProduct } from "../helpers/fixtures.js";

let t: TestDatabase;
let products: ReturnType<typeof createProductService>;
beforeAll(async () => {
  t = await createTestDatabase();
  products = createProductService(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await insertProduct(t.db, { sku: "ZJ-NK-001", name: "Bridal Kundan Necklace", approvedPrice: "485000.00" });
  await insertProduct(t.db, { sku: "ZJ-NK-002", name: "Polki Necklace Set", approvedPrice: null, stockStatus: null, stockQuantity: null });
  await insertProduct(t.db, { sku: "ZJ-BG-001", name: "Gold Bangle 100%", category: "bangle", collection: "daily", karat: 21, approvedPrice: "95000.00" });
  await insertProduct(t.db, { sku: "ZJ-RG-001", name: "Old Ring", category: "ring", isActive: false });
});

describe("searchProducts", () => {
  it("returns only database values, with unknown price left null", async () => {
    const results = await products.searchProducts({ query: "necklace" });
    expect(results.map((r) => r.sku)).toEqual(["ZJ-NK-001", "ZJ-NK-002"]);
    const polki = results.find((r) => r.sku === "ZJ-NK-002")!;
    expect(polki.approvedPrice).toBeNull();
    expect(polki.priceStatus).toBe("requires_confirmation");
    expect(polki.stockStatus).toBeNull();
  });

  it("price filters never match products without an approved price", async () => {
    const results = await products.searchProducts({ maxPrice: "500000" });
    expect(results.map((r) => r.sku).sort()).toEqual(["ZJ-BG-001", "ZJ-NK-001"]);
  });

  it("filters by category/karat and hides inactive products by default", async () => {
    expect((await products.searchProducts({ karat: 21 })).map((r) => r.sku)).toEqual(["ZJ-BG-001"]);
    expect(await products.searchProducts({ category: "ring" })).toEqual([]);
    expect((await products.searchProducts({ category: "RING", includeInactive: true })).map((r) => r.sku)).toEqual(["ZJ-RG-001"]);
  });

  it("treats LIKE wildcards in the query literally", async () => {
    expect((await products.searchProducts({ query: "100%" })).map((r) => r.sku)).toEqual(["ZJ-BG-001"]);
    // A bare "%" must match only names containing a literal percent sign, not everything.
    expect((await products.searchProducts({ query: "%" })).map((r) => r.sku)).toEqual(["ZJ-BG-001"]);
    expect(await products.searchProducts({ query: "_" })).toHaveLength(0);
  });

  it("rejects invalid filters", async () => {
    await expect(products.searchProducts({ maxPrice: "-5" })).rejects.toBeInstanceOf(ValidationError);
    await expect(products.searchProducts({ limit: 1000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(products.searchProducts({ unexpected: true } as never)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getProduct / checkInventory", () => {
  it("finds by SKU case-insensitively and by id", async () => {
    const p = await products.getProduct({ sku: "zj-nk-001" });
    expect(p.approvedPrice).toBe("485000.00");
    expect((await products.getProduct({ id: p.id })).sku).toBe("ZJ-NK-001");
  });

  it("throws ProductNotFound for unknown products", async () => {
    await expect(products.getProductBySku("ZJ-XX-999")).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(products.getProductById("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it("only allows promising stock when the database says so", async () => {
    expect(await products.checkInventory({ sku: "ZJ-NK-001" })).toMatchObject({
      availability: "available",
      canPromiseInStock: true,
      requiresConfirmation: false,
    });
    expect(await products.checkInventory({ sku: "ZJ-NK-002" })).toMatchObject({
      availability: "unknown",
      stockQuantity: null,
      canPromiseInStock: false,
      requiresConfirmation: true,
    });
    expect(await products.checkInventory({ sku: "ZJ-RG-001" })).toMatchObject({
      availability: "not_listed",
      canPromiseInStock: false,
    });
  });
});
