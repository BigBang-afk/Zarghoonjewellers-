import { describe, expect, it } from "vitest";
import { parseProductCsv } from "../../src/services/products/import/parseCsv.js";
import { validateImportRows } from "../../src/services/products/import/validateRows.js";

const HEADER =
  "sku,name,category,collection,metal,karat,weight_grams,making_charge,stone_cost,approved_price,stock_quantity,stock_status,is_active";

function run(csv: string, allowTestSkus = false) {
  const parsed = parseProductCsv(csv);
  if (parsed.issues.length) return { records: [], issues: parsed.issues };
  return validateImportRows(parsed.rows, { allowTestSkus });
}

describe("parseProductCsv", () => {
  it("parses rows with spreadsheet row numbers and normalizes unknown markers to null", () => {
    const parsed = parseProductCsv(`${HEADER}\nzj-br-001, Gold Bracelet ,bracelet,,gold,22K,12.5,N/A,,150000,3,Available,yes\n`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]!.rowNumber).toBe(2);
    expect(parsed.rows[0]!.cells.name).toBe("Gold Bracelet");
    expect(parsed.rows[0]!.cells.making_charge).toBeNull();
    expect(parsed.rows[0]!.cells.collection).toBeNull();
  });

  it("rejects unknown and missing columns so typos cannot drop data", () => {
    const parsed = parseProductCsv("sku,aproved_price\nZJ-BR-001,100\n");
    expect(parsed.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['Unknown column "aproved_price"', 'Missing required column "name"']),
    );
  });

  it("rejects empty files and malformed CSV", () => {
    expect(parseProductCsv("").issues[0]!.message).toBe("File is empty");
    expect(parseProductCsv(`${HEADER}\n`).issues[0]!.message).toBe("File contains no product rows");
    expect(parseProductCsv(`sku,name\nZJ-BR-001,"unterminated\n`).issues[0]!.message).toMatch(/could not be parsed/);
  });
});

describe("validateImportRows", () => {
  it("validates and normalizes a good row", () => {
    const { records, issues } = run(`${HEADER}\nzj-br-001,Gold Bracelet,bracelet,,Gold,22k,12.5,8000,,150000,3,available,yes\n`);
    expect(issues).toEqual([]);
    expect(records[0]).toMatchObject({
      sku: "ZJ-BR-001",
      karat: 22,
      metal: "gold",
      weightGrams: "12.500",
      makingCharge: "8000.00",
      stoneCost: null,
      approvedPrice: "150000.00",
      stockQuantity: 3,
      stockStatus: "available",
      isActive: true,
    });
  });

  it("reports row-numbered errors for invalid SKU, negative price, bad weight and bad stock", () => {
    const { issues } = run(
      [
        HEADER,
        "BAD SKU,Ring,,,,,,,,,,,",
        "ZJ-RG-002,Ring,,,,,0,,,-500,,,",
        "ZJ-RG-003,Ring,,,,30,,,,,,in stock,",
        "ZJ-RG-004,Ring,,,,,,,,,-2,,",
      ].join("\n"),
    );
    const at = (row: number) => issues.filter((i) => i.row === row).map((i) => i.column);
    expect(at(2)).toContain("sku");
    expect(at(3)).toEqual(expect.arrayContaining(["weight_grams", "approved_price"]));
    expect(at(4)).toEqual(expect.arrayContaining(["karat", "stock_status"]));
    expect(at(5)).toContain("stock_quantity");
  });

  it("rejects inconsistent stock status and quantity", () => {
    const { issues } = run(`${HEADER}\nZJ-RG-001,Ring,,,,,,,,,5,out_of_stock,\n`);
    expect(issues[0]!.message).toMatch(/out_of_stock/);
  });

  it("detects duplicate SKUs after normalization and flags every occurrence", () => {
    const { issues } = run(`${HEADER}\nZJ-RG-001,Ring A,,,,,,,,,,,\nzj-rg-001,Ring B,,,,,,,,,,,\n`);
    expect(issues.filter((i) => i.message.startsWith("Duplicate SKU")).map((i) => i.row)).toEqual([2, 3]);
  });

  it("blocks TEST- SKUs unless explicitly allowed", () => {
    const csv = `${HEADER}\nTEST-RG-001,Fixture Ring,,,,,,,,,,,\n`;
    expect(run(csv).issues[0]!.message).toMatch(/TEST- SKUs are blocked/);
    expect(run(csv, true).issues).toEqual([]);
  });
});
