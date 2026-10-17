/**
 * Zarghoon Sales Agent — interactive playground.
 *
 *   npm run sales                     # demo database (in memory) + Claude if ANTHROPIC_API_KEY is set
 *   npm run sales -- --offline        # demo database + rule-based offline model (no API key needed)
 *   npm run sales -- --db dev         # explicitly configured DEVELOPMENT database (see docs/sales-agent.md)
 *
 * Demo mode never touches a real database: it runs PostgreSQL in memory,
 * seeded with DEMO- products, and everything vanishes on exit. Nothing is
 * ever sent to a real customer.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createAnthropicLlmClient, loadLlmConfig, type LlmClient } from "../src/agents/llm/llmClient.js";
import { createSalesAgent } from "../src/agents/sales/salesAgent.js";
import type { SalesAgentResult } from "../src/agents/sales/types.js";
import { loadBusinessInfo, type BusinessInfo } from "../src/config/businessInfo.js";
import { createPgDb, type Db } from "../src/database/db.js";
import { createInMemoryDb } from "../src/database/pgliteDb.js";
import { DEMO_BUSINESS_INFO, seedDemoData } from "../src/demo/demoData.js";
import { createOfflineDemoModel } from "../src/demo/offlineDemoModel.js";
import { createZarghoonCore } from "../src/index.js";
import { toPublicError } from "../src/lib/errors.js";
import type { ActionContext } from "../src/types/context.js";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "demo" },
    offline: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function openDatabase(): Promise<{ db: Db; mode: string; businessInfo: BusinessInfo; staffId: string | null; close: () => Promise<void> }> {
  if (values.db === "demo") {
    const db = await createInMemoryDb();
    const seed = await seedDemoData(db);
    return { db, mode: "DEMO (in-memory database, DEMO- products)", businessInfo: DEMO_BUSINESS_INFO, staffId: seed.staffId, close: () => db.close() };
  }
  if (values.db === "dev") {
    // Never silently connect to production: require an explicitly named development database.
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to run the playground with NODE_ENV=production");
    if (process.env.ZARGHOON_ENV !== "development") {
      throw new Error("--db dev requires ZARGHOON_ENV=development to confirm this is a development database");
    }
    const url = process.env.SALES_PLAYGROUND_DATABASE_URL;
    if (!url) throw new Error("--db dev requires SALES_PLAYGROUND_DATABASE_URL (a development database, never production)");
    const db = createPgDb(url);
    return { db, mode: "DEVELOPMENT database (SALES_PLAYGROUND_DATABASE_URL)", businessInfo: loadBusinessInfo(), staffId: null, close: () => db.end() };
  }
  throw new Error(`Unknown --db "${values.db}" (use demo or dev)`);
}

function chooseModel(): { llm: LlmClient; label: string } {
  if (values.offline) return { llm: createOfflineDemoModel(), label: "offline rule-based demo model (not AI)" };
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(dim("ANTHROPIC_API_KEY is not set — using the offline demo model. Set it to talk to Claude.\n"));
    return { llm: createOfflineDemoModel(), label: "offline rule-based demo model (not AI)" };
  }
  const config = loadLlmConfig();
  return { llm: createAnthropicLlmClient(config), label: `Claude (${config.model}, effort ${config.effort})` };
}

function printResult(r: SalesAgentResult) {
  if (values.json) {
    console.log(dim(JSON.stringify(r, null, 2)));
  }
  if (r.reply) console.log(`${bold("Agent:")} ${r.reply}`);
  else console.log(`${bold("Agent:")} ${dim("(no AI reply — a human team member has taken over this conversation)")}`);
  const meta = [
    `status=${r.status}`,
    `intent=${r.intent}`,
    `lang=${r.language}`,
    `lead=${r.leadScore ?? "-"}/${r.leadClassification ?? "-"}`,
    r.toolsUsed.length ? `tools=${r.toolsUsed.join(",")}` : null,
    r.productsReferenced.length ? `products=${r.productsReferenced.map((p) => p.sku).join(",")}` : null,
    r.humanHandoff.required ? `HANDOFF=${r.humanHandoff.reason}/${r.humanHandoff.urgency}` : null,
  ].filter(Boolean);
  console.log(dim(`  [${meta.join(" · ")}]`));
}

async function main() {
  const database = await openDatabase();
  const { llm, label } = chooseModel();
  const core = createZarghoonCore({ db: database.db });
  const agent = createSalesAgent({ core, llm, businessInfo: database.businessInfo });
  const system: ActionContext = { actor: { type: "system", name: "sales_playground" } };

  // A playground customer identified only by a session id — no invented phone or email.
  const session = `playground-${Date.now()}`;
  const { customer } = await core.customers.createCustomer(
    { fullName: "Playground Customer", externalIdentities: [{ type: "website_visitor", value: session }] },
    system,
  );
  let conversationId: string | undefined;

  console.log(bold("\nZarghoon Sales Agent playground"));
  console.log(dim(`Database: ${database.mode}`));
  console.log(dim(`Model:    ${label}`));
  console.log(dim("Commands: /new (new conversation)  /release (staff hands back to AI)  /json (toggle details)  /quit\n"));

  const rl = createInterface({ input: process.stdin, terminal: false });
  const prompt = () => process.stdout.write(`${bold("Customer:")} `);
  try {
    prompt();
    // The async iterator buffers lines, so piped input works as well as typing.
    for await (const raw of rl) {
      const line = raw.trim();
      if (!process.stdin.isTTY) console.log(line);
      if (line === "/quit" || line === "/exit") break;
      await handleLine(line);
      prompt();
    }
  } finally {
    rl.close();
    await database.close();
  }

  async function handleLine(line: string) {
    if (!line) return;
    if (line === "/new") {
      conversationId = undefined;
      console.log(dim("  (new conversation)"));
      return;
    }
    if (line === "/json") {
      values.json = !values.json;
      return;
    }
    if (line === "/release") {
      if (!conversationId || !database.staffId) {
        console.log(dim("  (nothing to release, or no demo staff in this database)"));
        return;
      }
      await core.conversations.setHumanTakeover(conversationId, { active: false }, { actor: { type: "staff", staffId: database.staffId } });
      console.log(dim("  (DEMO staff released the conversation back to the AI)"));
      return;
    }
    try {
      const result = await agent.handleMessage({ customerId: customer.id, conversationId, message: line, channel: "internal_test" });
      conversationId = result.conversationId;
      printResult(result);
    } catch (error) {
      console.log(`  error: ${JSON.stringify(toPublicError(error))}`);
    }
  }
}

main().catch((error) => {
  console.error(`Playground failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
