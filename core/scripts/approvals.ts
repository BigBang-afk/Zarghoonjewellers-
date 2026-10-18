/**
 * Review approval requests (owner / manager / admin).
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run approvals                                   # list pending
 *   ZARGHOON_CORE_DATABASE_URL=… npm run approvals -- --approve <id> --staff-id <uuid> [--note "…"]
 *   ZARGHOON_CORE_DATABASE_URL=… npm run approvals -- --reject  <id> --staff-id <uuid> [--note "…"]
 */
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import { toPublicError } from "../src/lib/errors.js";
import { createZarghoonCore } from "../src/index.js";

const { values } = parseArgs({
  options: { approve: { type: "string" }, reject: { type: "string" }, "staff-id": { type: "string" }, note: { type: "string" } },
});

async function main() {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  if (!url) {
    console.error("Set ZARGHOON_CORE_DATABASE_URL.");
    return 2;
  }
  const db = createPgDb(url);
  try {
    const core = createZarghoonCore({ db });
    const id = values.approve ?? values.reject;
    if (id) {
      if (!values["staff-id"]) throw new Error("--staff-id is required");
      const ctx = { actor: { type: "staff", staffId: values["staff-id"] } } as const;
      const a = values.approve ? await core.approvals.approve(id, ctx, values.note) : await core.approvals.reject(id, ctx, values.note);
      console.log(`Approval ${a.id}: ${a.status}`);
      return 0;
    }
    const pending = await core.approvals.listPendingApprovals();
    if (!pending.length) console.log("No pending approvals.");
    for (const a of pending) console.log(`${a.id}  ${a.actionType}  ${a.createdAt.toISOString()}\n    ${a.reason}`);
    return 0;
  } catch (error) {
    console.error(JSON.stringify(toPublicError(error)));
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
