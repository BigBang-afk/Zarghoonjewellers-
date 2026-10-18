import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgliteDb } from "../../src/database/pgliteDb.js";
import { ApprovalRequiredError, ForbiddenActionError } from "../../src/lib/errors.js";
import type { SourceBatch, SourceProductInput } from "../../src/services/products/sync/sourceProduct.js";
import { floatWeightToDecimal, readWebsitePrismaProducts } from "../../src/services/products/sync/sources.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertProduct, insertStaff, staffCtx } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
let managerId: string;
beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  managerId = await insertStaff(t.db, { role: "manager" });
});

const batch = (records: SourceProductInput[], warnings: Record<string, string[]> = {}): SourceBatch => ({
  source: "website_export",
  records,
  warnings,
});
const count = async (table: string) => (await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n;

/** Preview → approval request → approve → apply, as an owner would. */
async function approveAndApply(b: SourceBatch, skuMap?: Map<string, string>) {
  const preview = await core.productSync.previewSync(b, { skuMap });
  const approval = await core.productSync.requestApproval(preview, staffCtx(managerId));
  await core.approvals.approve(approval.id, staffCtx(managerId));
  return { preview, result: await core.productSync.applySync(b, approval.id, staffCtx(managerId), { skuMap }) };
}

describe("preview", () => {
  it("never invents SKUs, prices or stock, and writes nothing", async () => {
    const preview = await core.productSync.previewSync(
      batch([
        { sourceProductId: "web-1", name: "Bridal Necklace", category: "Necklace", karat: 22, metal: "gold", weightGrams: "45.5" },
        { sourceProductId: "web-2", sku: "ZJ-RG-010", name: "Ring", price: "150000" },
      ]),
    );
    const [noSku, withSku] = preview.items;
    expect(noSku).toMatchObject({ action: "needs_sku", sku: null });
    expect(noSku!.issues[0]).toMatch(/never invented/);
    expect(withSku).toMatchObject({ action: "create", sku: "ZJ-RG-010" });
    expect(withSku!.changes.map((c) => c.field)).toEqual(["name", "approvedPrice", "currency"]);
    expect(withSku!.changes.find((c) => c.field === "stockStatus")).toBeUndefined();
    expect(preview.summary).toMatchObject({ create: 1, needs_sku: 1 });
    expect(await count("products")).toBe(0);
    expect(await count("approvals")).toBe(0);
  });

  it("uses an approved SKU map for products without SKUs", async () => {
    const preview = await core.productSync.previewSync(batch([{ sourceProductId: "web-1", name: "Bangle" }]), {
      skuMap: new Map([["web-1", "zj-bg-101"]]),
    });
    expect(preview.items[0]).toMatchObject({ action: "create", sku: "ZJ-BG-101" });
  });

  it("detects invalid records, duplicates and blocked SKUs", async () => {
    const preview = await core.productSync.previewSync(
      batch([
        { sourceProductId: "dup", sku: "ZJ-A-1", name: "A" },
        { sourceProductId: "dup", sku: "ZJ-A-2", name: "B" },
        { sourceProductId: "s1", sku: "ZJ-SAME-1", name: "C" },
        { sourceProductId: "s2", sku: "zj-same-1", name: "D" },
        { sourceProductId: "neg", sku: "ZJ-N-1", name: "E", price: "-5" } as never,
        { sourceProductId: "w", sku: "ZJ-W-1", name: "F", weightGrams: "0" },
        { sourceProductId: "k", sku: "ZJ-K-1", name: "G", karat: 30 },
        { sourceProductId: "test", sku: "TEST-X-1", name: "H" },
        { sourceProductId: "demo", sku: "DEMO-X-1", name: "I" },
        { sourceProductId: "stock", sku: "ZJ-S-1", name: "J", stockStatus: "out_of_stock", stockQuantity: 3 },
        { sourceProductId: "img", sku: "ZJ-I-1", name: "K", imageUrls: ["http://insecure.example/x.jpg"] },
        { sourceProductId: "extra", sku: "ZJ-X-1", name: "L", secretField: 1 } as never,
      ]),
    );
    const action = (id: string) => preview.items.filter((i) => i.sourceProductId === id).map((i) => i.action);
    expect(action("dup")).toEqual(["conflict", "conflict"]);
    expect(action("s1")).toEqual(["conflict"]);
    expect(action("s2")).toEqual(["conflict"]);
    for (const id of ["neg", "w", "k", "test", "demo", "img", "extra"]) expect(action(id), id).toEqual(["invalid"]);
    expect(action("stock")).toEqual(["conflict"]);
    expect(preview.summary.create).toBe(0);
  });
});

describe("apply", () => {
  const records: SourceProductInput[] = [
    { sourceProductId: "web-1", sku: "ZJ-NK-101", name: "Bridal Necklace", category: "Necklace", karat: 22, metal: "gold", weightGrams: "45.5", imageUrls: ["https://cdn.example.com/nk.jpg"] },
    { sourceProductId: "web-2", sku: "ZJ-BG-101", name: "Gold Bangles", price: "365000", stockQuantity: 2, stockStatus: "available" },
  ];

  it("requires an approved approval for exactly this plan, then applies atomically with links and audit", async () => {
    const b = batch(records);
    const preview = await core.productSync.previewSync(b);
    const approval = await core.productSync.requestApproval(preview, AI_CTX);
    await expect(core.productSync.applySync(b, approval.id, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    await expect(core.productSync.applySync(b, approval.id, staffCtx(managerId))).rejects.toBeInstanceOf(ApprovalRequiredError); // still pending
    expect(await count("products")).toBe(0);

    await core.approvals.approve(approval.id, staffCtx(managerId));
    const result = await core.productSync.applySync(b, approval.id, staffCtx(managerId));
    expect(result).toMatchObject({ created: 2, images: 1 });
    const necklace = await core.products.getProductBySku("ZJ-NK-101");
    expect(necklace).toMatchObject({ category: "necklace", karat: 22, weightGrams: "45.500", approvedPrice: null, stockStatus: null, stockQuantity: null });
    expect(await core.products.getPrimaryImageUrl(necklace.id)).toBe("https://cdn.example.com/nk.jpg");
    expect(await count("product_source_links")).toBe(2);
    const [audit] = await t.db.query<{ approval_id: string }>(`select approval_id from agent_actions where action_type = 'product_sync'`);
    expect(audit!.approval_id).toBe(approval.id);
    // An approval works once.
    await expect(core.productSync.applySync(b, approval.id, staffCtx(managerId))).rejects.toThrow(/already been used/);
  });

  it("refuses if the source changed after approval", async () => {
    const b = batch(records);
    const preview = await core.productSync.previewSync(b);
    const approval = await core.productSync.requestApproval(preview, staffCtx(managerId));
    await core.approvals.approve(approval.id, staffCtx(managerId));
    const changed = batch([{ ...records[0]!, name: "Renamed after approval" }, records[1]!]);
    await expect(core.productSync.applySync(changed, approval.id, staffCtx(managerId))).rejects.toThrow(/changed since this sync was approved/);
    expect(await count("products")).toBe(0);
  });

  it("re-syncing is idempotent and only updates what changed, preserving approved facts", async () => {
    await approveAndApply(batch(records));
    expect((await core.productSync.previewSync(batch(records))).summary).toMatchObject({ unchanged: 2, create: 0, update: 0 });

    const preview = await core.productSync.previewSync(
      batch([
        // name changes; karat/weight differ from stored (kept, flagged); price is new info (fills empty)
        { ...records[0]!, name: "Bridal Necklace Set", karat: 21, weightGrams: "44", price: "485000", description: null },
        // price differs from stored approved price (kept, flagged); stock explicitly changed; empty fields never blank data
        { sourceProductId: "web-2", sku: "ZJ-BG-101", name: "Gold Bangles", price: "399000", stockQuantity: 0, stockStatus: "out_of_stock" },
      ]),
    );
    const [nk, bg] = preview.items;
    expect(nk!.action).toBe("update");
    // Currency is already PKR, so filling the price changes nothing else.
    expect(nk!.changes.map((c) => c.field).sort()).toEqual(["approvedPrice", "name"]);
    expect(nk!.flags.join(" ")).toMatch(/Karat differs.*Weight differs/);
    expect(bg!.changes.map((c) => c.field).sort()).toEqual(["stockQuantity", "stockStatus"]);
    expect(bg!.flags.join(" ")).toMatch(/Approved price differs \(stored 365000.00, source 399000.00\)/);

    const approval = await core.productSync.requestApproval(preview, staffCtx(managerId));
    await core.approvals.approve(approval.id, staffCtx(managerId));
    const src = batch([
      { ...records[0]!, name: "Bridal Necklace Set", karat: 21, weightGrams: "44", price: "485000", description: null },
      { sourceProductId: "web-2", sku: "ZJ-BG-101", name: "Gold Bangles", price: "399000", stockQuantity: 0, stockStatus: "out_of_stock" },
    ]);
    await core.productSync.applySync(src, approval.id, staffCtx(managerId));
    expect(await core.products.getProductBySku("ZJ-NK-101")).toMatchObject({ name: "Bridal Necklace Set", karat: 22, weightGrams: "45.500", approvedPrice: "485000.00" });
    expect(await core.products.getProductBySku("ZJ-BG-101")).toMatchObject({ approvedPrice: "365000.00", stockStatus: "out_of_stock", stockQuantity: 0 });
  });

  it("links an existing catalogue product by SKU without overwriting its approved values", async () => {
    await insertProduct(t.db, { sku: "ZJ-NK-101", name: "Old name", approvedPrice: "500000.00", weightGrams: "46.000", karat: 22 });
    const preview = await core.productSync.previewSync(batch([records[0]!]));
    expect(preview.items[0]).toMatchObject({ action: "link" });
    expect(preview.items[0]!.flags.join(" ")).toMatch(/Weight differs/);
    const { result } = await approveAndApply(batch([records[0]!]));
    expect(result.linked).toBe(1);
    expect(await core.products.getProductBySku("ZJ-NK-101")).toMatchObject({ name: "Bridal Necklace", approvedPrice: "500000.00", weightGrams: "46.000" });
  });

  it("never deletes: products missing from the source are only reported", async () => {
    await approveAndApply(batch(records));
    const preview = await core.productSync.previewSync(batch([records[0]!]));
    expect(preview.missingFromSource.map((m) => m.sku)).toEqual(["ZJ-BG-101"]);
    expect(await count("products")).toBe(2);
  });

  it("a SKU already linked to another source product is a conflict", async () => {
    await approveAndApply(batch([records[0]!]));
    const preview = await core.productSync.previewSync(batch([{ ...records[0]!, sourceProductId: "web-999" }]));
    expect(preview.items[0]).toMatchObject({ action: "conflict" });
    expect(preview.items[0]!.issues[0]).toMatch(/already linked/);
  });
});

describe("website adapter (Prisma Product table)", () => {
  it("maps the website's fields without inventing anything", async () => {
    const pg = new PGlite();
    const web = new PgliteDb(pg);
    await web.exec(`
      create table "Product" (id text primary key, name text, category text, quality text, "netWeight" double precision,
        "wastagePercent" double precision, "grossWeight" double precision, "createdAt" timestamp default now(), "updatedAt" timestamp);
      create table "ProductImage" (id text primary key, url text, "productId" text references "Product"(id));
      insert into "Product" (id, name, category, quality, "netWeight", "wastagePercent", "grossWeight") values
        ('p1', 'Kundan Set', 'Necklace', '22K Gold (916)', 45.5, 10, 50.05),
        ('p2', 'Silver Payal', 'Anklet', 'Silver (925)', 12.3456789, 0, 12.3456789),
        ('p3', 'Mystery', 'Other', 'Other', 5, 0, 5);
      insert into "ProductImage" values ('i1', 'https://x.public.blob.vercel-storage.com/a.jpg', 'p1'), ('i2', 'http://insecure/b.jpg', 'p1');
    `);
    const out = await readWebsitePrismaProducts(web);
    expect(out.source).toBe("website_prisma");
    expect(out.records).toEqual([
      { sourceProductId: "p1", sku: null, name: "Kundan Set", category: "Necklace", metal: "gold", karat: 22, weightGrams: "45.500", imageUrls: ["https://x.public.blob.vercel-storage.com/a.jpg"] },
      { sourceProductId: "p2", sku: null, name: "Silver Payal", category: "Anklet", metal: "silver", karat: null, weightGrams: null, imageUrls: [] },
      { sourceProductId: "p3", sku: null, name: "Mystery", category: "Other", metal: null, karat: null, weightGrams: "5.000", imageUrls: [] },
    ]);
    expect(out.warnings.p1!.join(" ")).toMatch(/Non-HTTPS/);
    expect(out.warnings.p2!.join(" ")).toMatch(/not an exact 3-decimal value/);
    expect(out.warnings.p3!.join(" ")).toMatch(/Unrecognised quality "Other"/);
    // Gross weight (net + wastage%) is never used as the product weight.
    expect(JSON.stringify(out.records)).not.toContain("50.05");
    // End to end: website records become "needs SKU" until an approved map exists.
    const preview = await core.productSync.previewSync(out);
    expect(preview.summary.needs_sku).toBe(3);
    await pg.close();
  });

  it("float weights are only accepted when exactly representable to 3 decimals", () => {
    expect(floatWeightToDecimal(45.5)).toBe("45.500");
    expect(floatWeightToDecimal(0.1 + 0.2)).toBe("0.300");
    expect(floatWeightToDecimal(12.3456789)).toBeNull();
    expect(floatWeightToDecimal(0)).toBeNull();
    expect(floatWeightToDecimal(null)).toBeNull();
  });
});
