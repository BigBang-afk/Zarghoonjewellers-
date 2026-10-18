/**
 * Product CSV import CLI.
 *
 *   npm run products:import -- --file data/products.sample.csv            # dry run (default)
 *   npm run products:import -- --file products.csv --request-approval --staff-id <uuid>   # ask to approve price/weight/karat overwrites
 *   npm run products:import -- --file products.csv --apply --staff-id <uuid> [--approval-id <uuid>]
 *
 * Dry run is the default. --apply writes the whole file in one transaction
 * or nothing at all, and must be run as an owner/manager/admin staff member.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env.js";
import { createPgDb } from "../src/database/db.js";
import { toPublicError } from "../src/lib/errors.js";
import { createProductImportService } from "../src/services/products/import/productImportService.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    "staff-id": { type: "string" },
    "approval-id": { type: "string" },
    "request-approval": { type: "boolean", default: false },
  },
});

async function main(): Promise<number> {
  if (!values.file) {
    console.error("Usage: --file <path.csv> [--apply --staff-id <uuid> [--approval-id <uuid>]]");
    return 2;
  }
  if (values["request-approval"]) {
    if (!values["staff-id"]) {
      console.error("--request-approval requires --staff-id (who is asking)");
      return 2;
    }
    const env = loadEnv();
    const db = createPgDb(env.DATABASE_URL);
    try {
      const approval = await createProductImportService(db).requestCriticalChangesApproval(
        readFileSync(values.file, "utf8"),
        { actor: { type: "staff", staffId: values["staff-id"] }, requestId: `cli-import-approval-${Date.now()}` },
        { allowTestSkus: env.ALLOW_TEST_SKUS },
      );
      console.log(approval ? `Approval requested: ${approval.id} (${approval.reason})` : "No stored critical values change; no approval needed.");
      return 0;
    } catch (error) {
      console.error(JSON.stringify(toPublicError(error), null, 2));
      return 1;
    } finally {
      await db.end();
    }
  }
  if (values.apply && !values["staff-id"]) {
    console.error("--apply requires --staff-id (the staff member approving this import)");
    return 2;
  }
  const env = loadEnv();
  const db = createPgDb(env.DATABASE_URL);
  try {
    const importer = createProductImportService(db);
    const csv = readFileSync(values.file, "utf8");
    const report = values.apply
      ? await importer.importProducts(
          csv,
          { actor: { type: "staff", staffId: values["staff-id"]! }, requestId: `cli-import-${Date.now()}` },
          { dryRun: false, allowTestSkus: env.ALLOW_TEST_SKUS, criticalChangesApprovalId: values["approval-id"] },
        )
      : await importer.planImport(csv, { allowTestSkus: env.ALLOW_TEST_SKUS });
    console.log(JSON.stringify({ ...report, items: report.items.filter((i) => i.action !== "unchanged") }, null, 2));
    return report.valid ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify(toPublicError(error), null, 2));
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
