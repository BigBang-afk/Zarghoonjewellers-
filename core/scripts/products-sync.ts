/**
 * One-way product sync: existing website → Zarghoon AI catalogue.
 *
 *   # 1. Preview (read-only)
 *   npm run products:sync -- --source website-db [--sku-map skus.csv] [--report preview.json]
 *   npm run products:sync -- --source json --file export.json [--sku-map skus.csv]
 *   # 2. Ask for approval of exactly that preview
 *   npm run products:sync -- … --request-approval --staff-id <uuid>
 *   # 3. After an owner/manager approves it: apply
 *   npm run products:sync -- … --apply --approval-id <uuid> --staff-id <uuid>
 *
 * Env (server-side only): ZARGHOON_CORE_DATABASE_URL, and for website-db a
 * READ-ONLY connection in WEBSITE_DATABASE_URL. Nothing is ever deleted.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import { toPublicError } from "../src/lib/errors.js";
import { createZarghoonCore } from "../src/index.js";
import { readJsonProductFile, readSkuMapCsv, readWebsitePrismaProducts } from "../src/services/products/sync/sources.js";
import type { SourceBatch } from "../src/services/products/sync/sourceProduct.js";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    file: { type: "string" },
    "sku-map": { type: "string" },
    report: { type: "string" },
    "request-approval": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "approval-id": { type: "string" },
    "staff-id": { type: "string" },
  },
});

async function loadBatch(): Promise<SourceBatch> {
  if (values.source === "json") {
    if (!values.file) throw new Error("--source json requires --file");
    return readJsonProductFile(values.file);
  }
  if (values.source === "website-db") {
    const url = process.env.WEBSITE_DATABASE_URL;
    if (!url) throw new Error("--source website-db requires WEBSITE_DATABASE_URL (use a read-only role)");
    const web = createPgDb(url);
    try {
      return await readWebsitePrismaProducts(web);
    } finally {
      await web.end();
    }
  }
  throw new Error("--source must be website-db or json");
}

async function main(): Promise<number> {
  const coreUrl = process.env.ZARGHOON_CORE_DATABASE_URL;
  if (!coreUrl) {
    console.error("Set ZARGHOON_CORE_DATABASE_URL (server-side) to the Zarghoon AI database.");
    return 2;
  }
  const db = createPgDb(coreUrl);
  try {
    const core = createZarghoonCore({ db });
    const batch = await loadBatch();
    const skuMap = values["sku-map"] ? readSkuMapCsv(values["sku-map"]) : undefined;
    const staffCtx = values["staff-id"] ? ({ actor: { type: "staff", staffId: values["staff-id"] } } as const) : null;

    if (values.apply) {
      if (!values["approval-id"] || !staffCtx) throw new Error("--apply requires --approval-id and --staff-id");
      const result = await core.productSync.applySync(batch, values["approval-id"], staffCtx, { skuMap });
      console.log(`Applied: ${result.created} created, ${result.linked} linked, ${result.updated} updated, ${result.images} images. Audit ${result.auditActionId}`);
      return 0;
    }

    const preview = await core.productSync.previewSync(batch, { skuMap });
    console.log(`Source: ${preview.source} — ${batch.records.length} record(s)`);
    console.log(JSON.stringify(preview.summary));
    for (const item of preview.items) {
      const tag = `${item.action.padEnd(9)} ${item.sourceProductId} ${item.sku ?? "(no SKU)"} ${item.name ?? ""}`;
      console.log(tag);
      for (const c of item.changes) console.log(`    change ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
      if (item.newImages.length) console.log(`    + ${item.newImages.length} image(s)`);
      for (const f of item.flags) console.log(`    REVIEW ${f}`);
      for (const i of item.issues) console.log(`    ISSUE  ${i}`);
      for (const w of item.warnings) console.log(`    note   ${w}`);
    }
    for (const m of preview.missingFromSource) console.log(`not in source (kept): ${m.sku}`);
    console.log(`Plan hash: ${preview.planHash}`);
    if (values.report) writeFileSync(values.report, JSON.stringify(preview, null, 2));

    if (values["request-approval"]) {
      if (!staffCtx) throw new Error("--request-approval requires --staff-id");
      const approval = await core.productSync.requestApproval(preview, staffCtx);
      console.log(`Approval requested: ${approval.id} (an owner/manager must approve it before --apply)`);
    } else {
      console.log("Preview only — nothing was written.");
    }
    return 0;
  } catch (error) {
    console.error(JSON.stringify(toPublicError(error)));
    if (!(error instanceof Error) || !("code" in error)) console.error((error instanceof Error ? error.message : String(error)).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
