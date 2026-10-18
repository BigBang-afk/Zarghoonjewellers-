import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProductImportService } from "../../src/services/products/import/productImportService.js";
import { createApprovalService } from "../../src/services/approvalService.js";
import { createProductService } from "../../src/services/products/productService.js";
import { ApprovalRequiredError, ForbiddenActionError, InvalidProductImportError } from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { AI_CTX, insertApproval, insertProduct, insertStaff, staffCtx } from "../helpers/fixtures.js";

const HEADER = "sku,name,category,karat,weight_grams,approved_price,stock_quantity,stock_status";

let t: TestDatabase;
let importer: ReturnType<typeof createProductImportService>;
let products: ReturnType<typeof createProductService>;
let managerId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  importer = createProductImportService(t.db);
  products = createProductService(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  managerId = await insertStaff(t.db, { role: "manager" });
});

const count = async () => (await t.db.query<{ n: number }>(`select count(*)::int as n from products`))[0]!.n;

describe("dry run", () => {
  it("is the default and writes nothing", async () => {
    const report = await importer.importProducts(`${HEADER}\nZJ-BR-001,Bracelet,bracelet,22,12.5,150000,2,available\n`, staffCtx(managerId));
    expect(report).toMatchObject({ dryRun: true, valid: true, applied: false, summary: { toCreate: 1 } });
    expect(await count()).toBe(0);
  });

  it("compares against the database and reports field-level changes", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001", name: "Bracelet", category: "bracelet", stockQuantity: 2, approvedPrice: "150000.00", weightGrams: "12.500", karat: 22 });
    const report = await importer.planImport(
      `${HEADER}\nZJ-BR-001,Bracelet,bracelet,22,12.5,150000.00,5,available\nZJ-BR-002,New,bracelet,,,,,\n`,
    );
    expect(report.summary).toMatchObject({ toCreate: 1, toUpdate: 1, unchanged: 0, criticalChanges: 0 });
    expect(report.items[0]!.changes).toEqual([{ field: "stock_quantity", from: 2, to: 5, critical: false }]);
  });
});

describe("apply", () => {
  it("imports a valid file atomically and audits it", async () => {
    const report = await importer.importProducts(
      `${HEADER}\nZJ-BR-001,Bracelet,bracelet,22,12.5,150000,2,available\nZJ-RG-001,Ring,ring,,,,,\n`,
      staffCtx(managerId),
      { dryRun: false },
    );
    expect(report.applied).toBe(true);
    expect(await count()).toBe(2);
    const ring = await products.getProductBySku("ZJ-RG-001");
    expect(ring).toMatchObject({ approvedPrice: null, weightGrams: null, stockStatus: null, currency: "PKR", isActive: true });
    const [audit] = await t.db.query<{ action_type: string; actor_staff_id: string }>(
      `select action_type, actor_staff_id from agent_actions where id = $1`, [report.auditActionId],
    );
    expect(audit).toEqual({ action_type: "product_import", actor_staff_id: managerId });
  });

  it("writes nothing if any row is invalid (all-or-nothing)", async () => {
    const csv = `${HEADER}\nZJ-BR-001,Bracelet,,,,150000,,\nZJ-BR-002,Bad,,,,-10,,\n`;
    await expect(importer.importProducts(csv, staffCtx(managerId), { dryRun: false })).rejects.toBeInstanceOf(InvalidProductImportError);
    expect(await count()).toBe(0);
  });

  it("blocks TEST- SKUs by default", async () => {
    const csv = `${HEADER}\nTEST-BR-001,Fixture,,,,,,\n`;
    const report = await importer.planImport(csv);
    expect(report.valid).toBe(false);
    await expect(importer.importProducts(csv, staffCtx(managerId), { dryRun: false })).rejects.toBeInstanceOf(InvalidProductImportError);
    expect(await count()).toBe(0);
  });

  it("never blanks stored values from empty cells", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001", approvedPrice: "150000.00", weightGrams: "12.500" });
    const report = await importer.importProducts(`${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,,,\n`, staffCtx(managerId), { dryRun: false });
    expect(report.summary.unchanged).toBe(1);
    expect(await products.getProductBySku("ZJ-BR-001")).toMatchObject({ approvedPrice: "150000.00", weightGrams: "12.500" });
  });

  it("requires an approved price_change to overwrite critical values", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001", approvedPrice: "150000.00" });
    const csv = `${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,175000,,\n`;
    await expect(importer.importProducts(csv, staffCtx(managerId), { dryRun: false })).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect((await products.getProductBySku("ZJ-BR-001")).approvedPrice).toBe("150000.00");

    const pending = await insertApproval(t.db, { actionType: "price_change", status: "pending" });
    await expect(
      importer.importProducts(csv, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: pending }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    const wrongType = await insertApproval(t.db, { actionType: "discount", status: "approved", deciderId: managerId });
    await expect(
      importer.importProducts(csv, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: wrongType }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    // An approved price_change that does not name these exact changes is refused (step 12).
    const unbound = await insertApproval(t.db, { actionType: "price_change", status: "approved", deciderId: managerId });
    await expect(
      importer.importProducts(csv, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: unbound }),
    ).rejects.toThrow(/does not cover exactly/);

    const request = await importer.requestCriticalChangesApproval(csv, staffCtx(managerId));
    expect(request!.payload).toEqual({ kind: "product_import", changes: [{ sku: "ZJ-BR-001", field: "approved_price", from: "150000.00", to: "175000.00" }] });
    const approved = (await createApprovalService(t.db).approve(request!.id, staffCtx(managerId))).id;

    // The same approval cannot authorise a different price.
    const different = `${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,195000,,\n`;
    await expect(
      importer.importProducts(different, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: approved }),
    ).rejects.toThrow(/does not cover exactly/);
    expect((await products.getProductBySku("ZJ-BR-001")).approvedPrice).toBe("150000.00");

    const report = await importer.importProducts(csv, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: approved });
    expect(report.criticalChangeSkus).toEqual(["ZJ-BR-001"]);
    expect((await products.getProductBySku("ZJ-BR-001")).approvedPrice).toBe("175000.00");

    // An approval can only be used once.
    const again = `${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,180000,,\n`;
    await expect(
      importer.importProducts(again, staffCtx(managerId), { dryRun: false, criticalChangesApprovalId: approved }),
    ).rejects.toThrow(/already been used/);
  });

  it("filling a previously unknown critical value does not need approval", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001", approvedPrice: null });
    const report = await importer.importProducts(`${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,175000,,\n`, staffCtx(managerId), { dryRun: false });
    expect(report.summary.criticalChanges).toBe(0);
    expect((await products.getProductBySku("ZJ-BR-001")).approvedPrice).toBe("175000.00");
  });

  it("rejects updates whose merged stock state would be inconsistent", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001", stockQuantity: 3, stockStatus: "available" });
    const report = await importer.planImport(`${HEADER}\nZJ-BR-001,Bridal Kundan Necklace,,,,,,out_of_stock\n`);
    expect(report.valid).toBe(false);
    expect(report.issues[0]!.message).toMatch(/out_of_stock/);
  });

  it("cannot be applied by the AI or by non-manager staff", async () => {
    const csv = `${HEADER}\nZJ-BR-001,Bracelet,,,,,,\n`;
    await expect(importer.importProducts(csv, AI_CTX, { dryRun: false })).rejects.toBeInstanceOf(ForbiddenActionError);
    const sales = await insertStaff(t.db, { role: "sales" });
    await expect(importer.importProducts(csv, staffCtx(sales), { dryRun: false })).rejects.toBeInstanceOf(ForbiddenActionError);
    expect(await count()).toBe(0);
  });
});
