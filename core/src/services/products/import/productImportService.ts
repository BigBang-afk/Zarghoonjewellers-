import type { Db } from "../../../database/db.js";
import { ApprovalRequiredError, InvalidProductImportError } from "../../../lib/errors.js";
import { decimalEquals } from "../../../lib/money.js";
import { mapProductRow, stockConsistencyError, type Product, type ProductRow } from "../../../schemas/product.js";
import type { ActionContext } from "../../../types/context.js";
import { recordAction } from "../../auditService.js";
import { assertUsableApproval, createApprovalService } from "../../approvalService.js";
import { APPROVER_ROLES, requireStaffActor } from "../../staffRules.js";
import { parseProductCsv, type ImportIssue } from "./parseCsv.js";
import { validateImportRows, type ProductImportRecord } from "./validateRows.js";

/**
 * Stages 5–8 of the import pipeline: dry run, database comparison,
 * user-approved apply, audit.
 *
 * Safety rules:
 *  - Any validation issue anywhere in the file blocks the whole import.
 *  - A blank cell on an existing product means "no change" — imports never
 *    blank out stored values.
 *  - Overwriting an existing non-null *critical* value (price, cost, weight,
 *    karat, metal, currency) requires an approved `price_change` approval.
 *  - Only owner/manager/admin staff can apply an import. The AI cannot.
 */

type ProductField = Exclude<keyof ProductImportRecord, "rowNumber" | "sku">;

export const CRITICAL_FIELDS: readonly ProductField[] = [
  "approvedPrice",
  "makingCharge",
  "stoneCost",
  "weightGrams",
  "karat",
  "metal",
  "currency",
];
const DECIMAL_FIELDS = new Set<ProductField>(["approvedPrice", "makingCharge", "stoneCost", "weightGrams"]);

const COLUMN_FOR_FIELD: Record<ProductField, string> = {
  name: "name",
  description: "description",
  category: "category",
  collection: "collection",
  metal: "metal",
  karat: "karat",
  weightGrams: "weight_grams",
  makingCharge: "making_charge",
  stoneCost: "stone_cost",
  approvedPrice: "approved_price",
  currency: "currency",
  stockQuantity: "stock_quantity",
  stockStatus: "stock_status",
  size: "size",
  websiteUrl: "website_url",
  isActive: "is_active",
};
const FIELDS = Object.keys(COLUMN_FOR_FIELD) as ProductField[];

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
  critical: boolean;
}

export interface ImportPlanItem {
  row: number;
  sku: string;
  action: "create" | "update" | "unchanged";
  changes: FieldChange[];
}

export interface ImportReport {
  dryRun: boolean;
  valid: boolean;
  applied: boolean;
  issues: ImportIssue[];
  summary: {
    totalRows: number;
    toCreate: number;
    toUpdate: number;
    unchanged: number;
    criticalChanges: number;
  };
  items: ImportPlanItem[];
  /** Products whose critical values would be overwritten; these need approval. */
  criticalChangeSkus: string[];
  auditActionId: string | null;
}

export interface ProductImportOptions {
  /** Defaults to true. Nothing is written unless this is explicitly false. */
  dryRun?: boolean;
  allowTestSkus?: boolean;
  /** Approved `price_change` approval covering critical-value overwrites. */
  criticalChangesApprovalId?: string;
}

function sameValue(field: ProductField, a: unknown, b: unknown): boolean {
  if (DECIMAL_FIELDS.has(field)) return decimalEquals(a as string | null, b as string | null);
  return a === b;
}

function diff(record: ProductImportRecord, existing: Product): { changes: FieldChange[]; issue: string | null } {
  const changes: FieldChange[] = [];
  for (const field of FIELDS) {
    const incoming = record[field];
    if (incoming === null) continue; // blank cell → keep stored value
    const current = existing[field as keyof Product];
    if (sameValue(field, incoming, current)) continue;
    changes.push({
      field: COLUMN_FOR_FIELD[field],
      from: current,
      to: incoming,
      critical: CRITICAL_FIELDS.includes(field) && current !== null,
    });
  }
  // The merged result must still satisfy stock consistency.
  const status = record.stockStatus ?? existing.stockStatus;
  const quantity = record.stockQuantity ?? existing.stockQuantity;
  return { changes, issue: stockConsistencyError(status, quantity) };
}

function emptyReport(dryRun: boolean, issues: ImportIssue[], totalRows: number): ImportReport {
  return {
    dryRun,
    valid: false,
    applied: false,
    issues,
    summary: { totalRows, toCreate: 0, toUpdate: 0, unchanged: 0, criticalChanges: 0 },
    items: [],
    criticalChangeSkus: [],
    auditActionId: null,
  };
}

async function buildPlan(
  db: Db,
  csvText: string,
  options: { dryRun: boolean; allowTestSkus: boolean; lock: boolean },
): Promise<{ report: ImportReport; records: ProductImportRecord[]; existing: Map<string, Product> }> {
  const parsed = parseProductCsv(csvText);
  if (parsed.issues.length > 0) {
    return { report: emptyReport(options.dryRun, parsed.issues, parsed.rows.length), records: [], existing: new Map() };
  }
  const { records, issues } = validateImportRows(parsed.rows, { allowTestSkus: options.allowTestSkus });
  if (issues.length > 0) {
    return { report: emptyReport(options.dryRun, issues, parsed.rows.length), records: [], existing: new Map() };
  }

  const rows = await db.query<ProductRow>(
    `select * from products where sku = any($1::text[]) ${options.lock ? "for update" : ""}`,
    [records.map((r) => r.sku)],
  );
  const existing = new Map(rows.map((r) => [r.sku, mapProductRow(r)]));

  const items: ImportPlanItem[] = [];
  const planIssues: ImportIssue[] = [];
  for (const record of records) {
    const current = existing.get(record.sku);
    if (!current) {
      items.push({
        row: record.rowNumber,
        sku: record.sku,
        action: "create",
        changes: FIELDS.filter((f) => record[f] !== null).map((f) => ({
          field: COLUMN_FOR_FIELD[f],
          from: null,
          to: record[f],
          critical: false,
        })),
      });
      continue;
    }
    const { changes, issue } = diff(record, current);
    if (issue) planIssues.push({ row: record.rowNumber, column: "stock_status", message: `After merge: ${issue}` });
    items.push({ row: record.rowNumber, sku: record.sku, action: changes.length ? "update" : "unchanged", changes });
  }

  if (planIssues.length > 0) {
    return { report: emptyReport(options.dryRun, planIssues, records.length), records: [], existing: new Map() };
  }

  const criticalChangeSkus = items.filter((i) => i.changes.some((c) => c.critical)).map((i) => i.sku);
  const report: ImportReport = {
    dryRun: options.dryRun,
    valid: true,
    applied: false,
    issues: [],
    summary: {
      totalRows: records.length,
      toCreate: items.filter((i) => i.action === "create").length,
      toUpdate: items.filter((i) => i.action === "update").length,
      unchanged: items.filter((i) => i.action === "unchanged").length,
      criticalChanges: items.reduce((n, i) => n + i.changes.filter((c) => c.critical).length, 0),
    },
    items,
    criticalChangeSkus,
    auditActionId: null,
  };
  return { report, records, existing };
}

async function insertProduct(db: Db, r: ProductImportRecord): Promise<void> {
  await db.query(
    `insert into products
       (sku, name, description, category, collection, metal, karat, weight_grams, making_charge,
        stone_cost, approved_price, currency, stock_quantity, stock_status, size, website_url, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, 'PKR'), $13, $14, $15, $16, coalesce($17, true))`,
    [
      r.sku,
      r.name,
      r.description,
      r.category,
      r.collection,
      r.metal,
      r.karat,
      r.weightGrams,
      r.makingCharge,
      r.stoneCost,
      r.approvedPrice,
      r.currency,
      r.stockQuantity,
      r.stockStatus,
      r.size,
      r.websiteUrl,
      r.isActive,
    ],
  );
}

async function updateProduct(db: Db, sku: string, changes: FieldChange[]): Promise<void> {
  // Column names come from the fixed COLUMN_FOR_FIELD whitelist, never from input.
  const sets = changes.map((c, i) => `${c.field} = $${i + 2}`);
  await db.query(`update products set ${sets.join(", ")} where sku = $1`, [sku, ...changes.map((c) => c.to)]);
}

/** The exact critical overwrites in a plan, in a stable order — what an approval must cover. */
function criticalChangeList(report: ImportReport): { sku: string; field: string; from: string | null; to: string | null }[] {
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return report.items
    .flatMap((i) => i.changes.filter((c) => c.critical).map((c) => ({ sku: i.sku, field: c.field, from: text(c.from), to: text(c.to) })))
    .sort((a, b) => (a.sku + a.field).localeCompare(b.sku + b.field));
}

/** Order-independent of object keys (jsonb reorders them). */
function changeKey(changes: unknown): string {
  if (!Array.isArray(changes)) return "invalid";
  return JSON.stringify(changes.map((c: Record<string, unknown>) => [c?.sku, c?.field, c?.from, c?.to]));
}

export function createProductImportService(db: Db) {
  /** Validates and compares against the database. Never writes. */
  async function planImport(csvText: string, options: Pick<ProductImportOptions, "allowTestSkus"> = {}) {
    const { report } = await buildPlan(db, csvText, {
      dryRun: true,
      allowTestSkus: options.allowTestSkus ?? false,
      lock: false,
    });
    return report;
  }

  /**
   * Runs the import. Dry run by default; with `dryRun: false` the whole file
   * is applied in one transaction or not at all.
   */
  async function importProducts(csvText: string, ctx: ActionContext, options: ProductImportOptions = {}) {
    const dryRun = options.dryRun ?? true;
    const allowTestSkus = options.allowTestSkus ?? false;
    if (dryRun) return planImport(csvText, { allowTestSkus });

    await requireStaffActor(db, ctx, "apply a product import", APPROVER_ROLES);

    return db.transaction(async (tx) => {
      const { report, records } = await buildPlan(tx, csvText, { dryRun: false, allowTestSkus, lock: true });
      if (!report.valid) {
        throw new InvalidProductImportError(`Import rejected: ${report.issues.length} issue(s) found`, {
          issues: report.issues,
        });
      }

      let approvalId: string | null = null;
      if (report.criticalChangeSkus.length > 0) {
        if (!options.criticalChangesApprovalId) {
          throw new ApprovalRequiredError("Overwriting critical product values requires an approved price_change", {
            approvalType: "price_change",
            skus: report.criticalChangeSkus,
          });
        }
        const approval = await assertUsableApproval(tx, options.criticalChangesApprovalId, "price_change", "product_import");
        // The approval must name exactly these overwrites (same products, fields, old and new
        // values) — an approval for one price can never authorise a different one.
        if (approval.payload.kind !== "product_import" || changeKey(approval.payload.changes) !== changeKey(criticalChangeList(report))) {
          throw new ApprovalRequiredError("This approval does not cover exactly these product changes; request a new approval for this file", {
            approvalId: options.criticalChangesApprovalId,
            skus: report.criticalChangeSkus,
          });
        }
        approvalId = options.criticalChangesApprovalId;
      }

      const bySku = new Map(records.map((r) => [r.sku, r]));
      for (const item of report.items) {
        if (item.action === "create") await insertProduct(tx, bySku.get(item.sku)!);
        else if (item.action === "update") await updateProduct(tx, item.sku, item.changes);
      }

      report.applied = true;
      report.auditActionId = await recordAction(tx, ctx, {
        actionType: "product_import",
        approvalId,
        requiresApproval: approvalId !== null,
        input: { rows: report.summary.totalRows, allowTestSkus },
        output: { summary: report.summary, items: report.items.filter((i) => i.action !== "unchanged") },
      });
      return report;
    });
  }

  /**
   * Asks an owner/manager to approve the critical overwrites in this file. The
   * request lists every changed value; only that exact set can be applied with it.
   */
  async function requestCriticalChangesApproval(csvText: string, ctx: ActionContext, options: Pick<ProductImportOptions, "allowTestSkus"> = {}) {
    const report = await planImport(csvText, options);
    if (!report.valid) {
      throw new InvalidProductImportError(`Import rejected: ${report.issues.length} issue(s) found`, { issues: report.issues });
    }
    const changes = criticalChangeList(report);
    if (changes.length === 0) return null;
    return createApprovalService(db).createApprovalRequest(
      {
        actionType: "price_change",
        reason: `Product import overwrites ${changes.length} stored price/weight/karat value(s) on ${report.criticalChangeSkus.length} product(s)`,
        payload: { kind: "product_import", changes },
      },
      ctx,
    );
  }

  return { planImport, importProducts, requestCriticalChangesApproval };
}

export type ProductImportService = ReturnType<typeof createProductImportService>;
