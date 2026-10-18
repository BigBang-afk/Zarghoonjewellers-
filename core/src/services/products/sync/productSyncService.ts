import { createHash } from "node:crypto";
import { queryOne, type Db } from "../../../database/db.js";
import { ApprovalRequiredError, InvalidStateError } from "../../../lib/errors.js";
import { decimalEquals } from "../../../lib/money.js";
import { zodIssues } from "../../../lib/validation.js";
import {
  isDemoSku,
  isTestSku,
  mapProductRow,
  skuSchema,
  stockConsistencyError,
  type Product,
  type ProductRow,
} from "../../../schemas/product.js";
import type { ActionContext } from "../../../types/context.js";
import { assertUsableApproval, createApprovalService } from "../../approvalService.js";
import { recordAction } from "../../auditService.js";
import { APPROVER_ROLES, requireStaffActor } from "../../staffRules.js";
import { sourceProductSchema, type SourceBatch, type SourceProduct } from "./sourceProduct.js";

/**
 * One-way product synchronisation: external source → validation → review → Zarghoon AI.
 *
 *   previewSync()        read-only plan with a hash; nothing is written
 *   requestApproval()    records an approval request for exactly that plan
 *   applySync()          owner/manager/admin applies an APPROVED plan; if the
 *                        source or catalogue changed since approval, it refuses
 *
 * Rules (enforced here, not left to reviewers):
 *  - Never deletes products or links; products missing from the source are only reported.
 *  - Never invents a SKU: records without one (in the source or the approved
 *    SKU map) are "needs_sku" and skipped.
 *  - Never overwrites an approved price, weight, karat or metal: it may only
 *    fill an empty value. Differences are flagged for manual review.
 *  - Never assumes stock: only explicit source stock facts are synced.
 *  - Never blanks a stored value from an empty source field.
 */

export type SyncAction = "create" | "link" | "update" | "unchanged" | "needs_sku" | "invalid" | "conflict";

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface SyncItem {
  sourceProductId: string;
  sku: string | null;
  name: string | null;
  action: SyncAction;
  productId: string | null;
  /** Applied when the plan is approved. */
  changes: FieldChange[];
  newImages: string[];
  /** Differences deliberately NOT applied (approved prices, known weights…) — for a human to review. */
  flags: string[];
  /** Why the record is invalid / in conflict / needs a SKU. */
  issues: string[];
  /** Adapter notes about lossy or missing source data. */
  warnings: string[];
}

export interface SyncPreview {
  source: string;
  items: SyncItem[];
  missingFromSource: { productId: string; sku: string; sourceProductId: string }[];
  summary: Record<SyncAction, number> & { flagged: number; missingFromSource: number };
  planHash: string;
}

export interface SyncOptions {
  /** Approved mapping source product id → SKU (see readSkuMapCsv). */
  skuMap?: Map<string, string>;
  /** Development fixtures only. */
  allowTestSkus?: boolean;
}

const ACTIONABLE: SyncAction[] = ["create", "link", "update"];

/** Product columns the sync may write, keyed by Product field name. */
const COLUMN: Record<string, string> = {
  name: "name",
  description: "description",
  category: "category",
  collection: "collection",
  websiteUrl: "website_url",
  metal: "metal",
  karat: "karat",
  weightGrams: "weight_grams",
  approvedPrice: "approved_price",
  currency: "currency",
  stockQuantity: "stock_quantity",
  stockStatus: "stock_status",
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function same(field: string, a: unknown, b: unknown): boolean {
  if (field === "weightGrams" || field === "approvedPrice") return decimalEquals(a as string | null, b as string | null);
  return a === b;
}

/** Field-by-field merge of a source record onto an existing product, applying the safety rules. */
function diffProduct(src: SourceProduct, current: Product): { changes: FieldChange[]; flags: string[]; issues: string[] } {
  const changes: FieldChange[] = [];
  const flags: string[] = [];
  const issues: string[] = [];
  const propose = (field: keyof Product, to: unknown) => {
    if (to === null || to === undefined) return; // empty source value never blanks stored data
    const from = current[field];
    if (same(field, from, to)) return;
    changes.push({ field, from, to });
  };
  const fillOnly = (field: keyof Product, to: unknown, label: string) => {
    if (to === null || to === undefined) return;
    const from = current[field];
    if (from === null) changes.push({ field, from, to });
    else if (!same(field, from, to)) flags.push(`${label} differs (stored ${String(from)}, source ${String(to)}): kept stored value`);
  };

  // Descriptive fields: the source may update them.
  propose("name", src.name);
  propose("description", src.description);
  propose("category", src.category);
  propose("collection", src.collection);
  propose("websiteUrl", src.productUrl);
  // Facts that affect what customers are told: fill-only.
  fillOnly("metal", src.metal, "Metal");
  fillOnly("karat", src.karat, "Karat");
  fillOnly("weightGrams", src.weightGrams, "Weight");
  fillOnly("approvedPrice", src.price, "Approved price");
  if (src.price !== null) fillOnly("currency", src.currency ?? "PKR", "Currency");

  // Stock: only explicit facts, and the merged state must stay consistent.
  if (src.stockQuantity !== null || src.stockStatus !== null) {
    const status = src.stockStatus ?? current.stockStatus;
    const quantity = src.stockQuantity ?? current.stockQuantity;
    const problem = stockConsistencyError(status, quantity);
    if (problem) issues.push(`Stock would become inconsistent: ${problem}`);
    else {
      propose("stockStatus", src.stockStatus);
      propose("stockQuantity", src.stockQuantity);
    }
  }
  return { changes, flags, issues };
}

export function createProductSyncService(db: Db) {
  async function buildPreview(tx: Db, batch: SourceBatch, options: SyncOptions, lock: boolean): Promise<{ preview: SyncPreview; parsed: Map<string, SourceProduct> }> {
    const items: SyncItem[] = [];
    const parsed = new Map<string, SourceProduct>();
    const idCounts = new Map<string, number>();
    for (const raw of batch.records) {
      const id = typeof raw === "object" && raw && "sourceProductId" in raw ? String((raw as { sourceProductId: unknown }).sourceProductId) : "";
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }

    // Existing links for this source.
    const links = await tx.query<{ source_product_id: string; product_id: string; source_hash: string }>(
      `select source_product_id, product_id, source_hash from product_source_links where source = $1 ${lock ? "for update" : ""}`,
      [batch.source],
    );
    const linkBySourceId = new Map(links.map((l) => [l.source_product_id, l]));
    const linkByProductId = new Map(links.map((l) => [l.product_id, l]));

    // 1. Validate and resolve SKUs.
    const pending: { src: SourceProduct; sku: string | null; item: SyncItem }[] = [];
    for (const raw of batch.records) {
      const result = sourceProductSchema.safeParse(raw);
      const rawId = typeof raw === "object" && raw && "sourceProductId" in raw ? String((raw as { sourceProductId: unknown }).sourceProductId) : "(missing id)";
      const item: SyncItem = {
        sourceProductId: rawId,
        sku: null,
        name: typeof raw === "object" && raw && "name" in raw ? String((raw as { name: unknown }).name) : null,
        action: "invalid",
        productId: null,
        changes: [],
        newImages: [],
        flags: [],
        issues: [],
        warnings: batch.warnings[rawId] ?? [],
      };
      items.push(item);
      if (!result.success) {
        item.issues = zodIssues(result.error).map((i) => `${i.path || "record"}: ${i.message}`);
        continue;
      }
      const src = result.data;
      if ((idCounts.get(src.sourceProductId) ?? 0) > 1) {
        item.action = "conflict";
        item.issues.push("The same source product id appears more than once in this batch");
        continue;
      }
      let sku = src.sku;
      const mapped = options.skuMap?.get(src.sourceProductId);
      if (mapped) {
        const m = skuSchema.safeParse(mapped);
        if (!m.success) {
          item.issues.push(`SKU map value "${mapped}" is not a valid SKU`);
          continue;
        }
        if (sku && sku !== m.data) {
          item.action = "conflict";
          item.issues.push(`Source SKU ${sku} disagrees with SKU map ${m.data}`);
          continue;
        }
        sku = m.data;
      }
      if (sku && !options.allowTestSkus && (isTestSku(sku) || isDemoSku(sku))) {
        item.issues.push(`${sku}: TEST-/DEMO- SKUs are blocked from the real catalogue`);
        continue;
      }
      item.sku = sku;
      item.name = src.name;
      parsed.set(src.sourceProductId, src);
      pending.push({ src, sku, item });
    }

    // 2. Duplicate SKUs inside the batch.
    const skuCounts = new Map<string, number>();
    for (const p of pending) if (p.sku) skuCounts.set(p.sku, (skuCounts.get(p.sku) ?? 0) + 1);

    // 3. Current catalogue state for everything referenced.
    const linkedIds = pending.map((p) => linkBySourceId.get(p.src.sourceProductId)?.product_id).filter((x): x is string => !!x);
    const skus = pending.map((p) => p.sku).filter((x): x is string => !!x);
    const productRows = await tx.query<ProductRow>(
      `select * from products where id = any($1::uuid[]) or sku = any($2::text[]) ${lock ? "for update" : ""}`,
      [linkedIds, skus],
    );
    const byId = new Map(productRows.map((r) => [r.id, mapProductRow(r)]));
    const bySku = new Map(productRows.map((r) => [r.sku, mapProductRow(r)]));
    const imageRows = await tx.query<{ product_id: string; url: string }>(
      `select product_id, url from product_images where product_id = any($1::uuid[])`,
      [productRows.map((r) => r.id)],
    );
    const imagesOf = (productId: string) => new Set(imageRows.filter((i) => i.product_id === productId).map((i) => i.url));

    // 4. Decide each record.
    for (const { src, sku, item } of pending) {
      item.action = "conflict";
      if (sku && (skuCounts.get(sku) ?? 0) > 1) {
        item.issues.push(`SKU ${sku} is used by more than one source product in this batch`);
        continue;
      }
      const link = linkBySourceId.get(src.sourceProductId);
      let target: Product | null = null;
      if (link) {
        target = byId.get(link.product_id) ?? null;
        if (!target) {
          item.issues.push("Linked product no longer exists");
          continue;
        }
        if (sku && sku !== target.sku) {
          item.issues.push(`Source now maps to SKU ${sku} but is linked to ${target.sku}: review manually`);
          continue;
        }
        item.sku = target.sku;
      } else if (sku && bySku.has(sku)) {
        target = bySku.get(sku)!;
        const otherLink = linkByProductId.get(target.id);
        if (otherLink) {
          item.issues.push(`SKU ${sku} is already linked to source product ${otherLink.source_product_id}`);
          continue;
        }
      } else if (!sku) {
        item.action = "needs_sku";
        item.issues.push("No SKU in the source and none in the approved SKU map — not imported (SKUs are never invented)");
        continue;
      }

      if (target) {
        const { changes, flags, issues } = diffProduct(src, target);
        if (issues.length) {
          item.issues.push(...issues);
          continue;
        }
        const existing = imagesOf(target.id);
        item.productId = target.id;
        item.changes = changes;
        item.flags = flags;
        item.newImages = src.imageUrls.filter((u) => !existing.has(u));
        item.action = link ? (changes.length || item.newImages.length ? "update" : "unchanged") : "link";
      } else {
        const problem = stockConsistencyError(src.stockStatus, src.stockQuantity);
        if (problem) {
          item.issues.push(`Inconsistent stock: ${problem}`);
          continue;
        }
        item.action = "create";
        item.changes = Object.entries({
          name: src.name,
          description: src.description,
          category: src.category,
          collection: src.collection,
          websiteUrl: src.productUrl,
          metal: src.metal,
          karat: src.karat,
          weightGrams: src.weightGrams,
          approvedPrice: src.price,
          currency: src.price !== null ? (src.currency ?? "PKR") : null,
          stockQuantity: src.stockQuantity,
          stockStatus: src.stockStatus,
        })
          .filter(([, v]) => v !== null)
          .map(([field, to]) => ({ field, from: null, to }));
        item.newImages = [...new Set(src.imageUrls)];
      }
    }

    const seen = new Set(pending.map((p) => p.src.sourceProductId));
    const missingLinks = links.filter((l) => !seen.has(l.source_product_id));
    const missingSkus = new Map(
      (
        await tx.query<{ id: string; sku: string }>(`select id, sku from products where id = any($1::uuid[])`, [
          missingLinks.map((l) => l.product_id),
        ])
      ).map((r) => [r.id, r.sku]),
    );
    const missingFromSource = missingLinks.map((l) => ({
      productId: l.product_id,
      sku: missingSkus.get(l.product_id) ?? "(product removed)",
      sourceProductId: l.source_product_id,
    }));

    const summary = { create: 0, link: 0, update: 0, unchanged: 0, needs_sku: 0, invalid: 0, conflict: 0, flagged: 0, missingFromSource: missingFromSource.length };
    for (const i of items) {
      summary[i.action]++;
      if (i.flags.length) summary.flagged++;
    }
    const planHash = sha256({
      source: batch.source,
      plan: items
        .filter((i) => ACTIONABLE.includes(i.action))
        .map((i) => ({ id: i.sourceProductId, sku: i.sku, action: i.action, productId: i.productId, changes: i.changes, images: i.newImages })),
    });
    return { preview: { source: batch.source, items, missingFromSource, summary, planHash }, parsed };
  }

  /** Read-only preview. Nothing is written. */
  async function previewSync(batch: SourceBatch, options: SyncOptions = {}): Promise<SyncPreview> {
    return (await buildPreview(db, batch, options, false)).preview;
  }

  /** Records an approval request for exactly this preview (by hash). */
  async function requestApproval(preview: SyncPreview, ctx: ActionContext) {
    const s = preview.summary;
    return createApprovalService(db).createApprovalRequest(
      {
        actionType: "other",
        reason: `Product sync from ${preview.source}: ${s.create} new, ${s.link} linked, ${s.update} updated; ${s.needs_sku} need SKUs, ${s.conflict + s.invalid} need fixing, ${s.flagged} flagged for review`,
        payload: { kind: "product_sync", source: preview.source, planHash: preview.planHash, summary: s },
      },
      ctx,
    );
  }

  /** Applies an approved plan atomically. Refuses if the plan changed since approval. */
  async function applySync(batch: SourceBatch, approvalId: string, ctx: ActionContext, options: SyncOptions = {}) {
    await requireStaffActor(db, ctx, "apply a product sync", APPROVER_ROLES);
    return db.transaction(async (tx) => {
      const approval = await assertUsableApproval(tx, approvalId, "other", "product_sync");
      if (approval.payload.kind !== "product_sync") {
        throw new ApprovalRequiredError("Approval is not for a product sync", { approvalId });
      }
      const { preview, parsed } = await buildPreview(tx, batch, options, true);
      if (approval.payload.planHash !== preview.planHash) {
        throw new ApprovalRequiredError("The source data or catalogue changed since this sync was approved; preview and approve again", {
          approvalId,
        });
      }

      let created = 0;
      let updated = 0;
      let linked = 0;
      let images = 0;
      for (const item of preview.items.filter((i) => ACTIONABLE.includes(i.action))) {
        const src = parsed.get(item.sourceProductId)!;
        let productId = item.productId;
        if (item.action === "create") {
          const values = Object.fromEntries(item.changes.map((c) => [c.field, c.to]));
          const row = await queryOne<{ id: string }>(
            tx,
            `insert into products (sku, name, description, category, collection, website_url, metal, karat, weight_grams,
                                   approved_price, currency, stock_quantity, stock_status)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, 'PKR'), $12, $13) returning id`,
            [
              item.sku,
              values.name,
              values.description ?? null,
              values.category ?? null,
              values.collection ?? null,
              values.websiteUrl ?? null,
              values.metal ?? null,
              values.karat ?? null,
              values.weightGrams ?? null,
              values.approvedPrice ?? null,
              values.currency ?? null,
              values.stockQuantity ?? null,
              values.stockStatus ?? null,
            ],
          );
          productId = row!.id;
          created++;
        } else if (item.changes.length) {
          // Columns come only from the fixed COLUMN whitelist.
          const sets = item.changes.map((c, i) => `${COLUMN[c.field]} = $${i + 2}`);
          await tx.query(`update products set ${sets.join(", ")} where id = $1`, [productId, ...item.changes.map((c) => c.to)]);
          updated++;
        }
        for (const url of item.newImages) {
          await tx.query(`insert into product_images (product_id, url, sort_order) values ($1, $2, $3)`, [productId, url, images]);
          images++;
        }
        await tx.query(
          `insert into product_source_links (source, source_product_id, product_id, source_hash)
           values ($1, $2, $3, $4)
           on conflict (source, source_product_id) do update set source_hash = excluded.source_hash, last_synced_at = now()`,
          [preview.source, item.sourceProductId, productId, sha256(src)],
        );
        if (item.action === "link") linked++;
      }
      if (created + updated + linked + images === 0 && preview.summary.create + preview.summary.link + preview.summary.update === 0) {
        throw new InvalidStateError("Nothing to apply in this sync");
      }

      const auditId = await recordAction(tx, ctx, {
        actionType: "product_sync",
        approvalId,
        requiresApproval: true,
        input: { source: preview.source, planHash: preview.planHash },
        output: { created, updated, linked, images, summary: preview.summary },
      });
      return { created, updated, linked, images, auditActionId: auditId, preview };
    });
  }

  return { previewSync, requestApproval, applySync };
}

export type ProductSyncService = ReturnType<typeof createProductSyncService>;
