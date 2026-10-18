/**
 * Read-only CRM report for staff/testing (never writes).
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run crm:report [-- --limit 20]
 *
 * Phone numbers and emails are masked; message text is not printed.
 */
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import { describeDatabase } from "../src/database/migrator.js";

const { values } = parseArgs({ options: { limit: { type: "string", default: "15" } } });
const limit = Math.min(Number(values.limit) || 15, 200);

const mask = (v: string | null) => (v ? `${v.slice(0, 4)}…${v.slice(-2)}` : "—");

async function main() {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  if (!url) {
    console.error("Set ZARGHOON_CORE_DATABASE_URL.");
    return 2;
  }
  const db = createPgDb(url);
  try {
    const id = await describeDatabase(db);
    console.log(`Database "${id.database}" — environment: ${id.environment ?? "not initialised"}\n`);
    const section = async (title: string, sql: string, params: unknown[] = []) => {
      const rows = await db.query<Record<string, unknown>>(sql, params);
      console.log(`== ${title} (${rows.length}) ==`);
      if (rows.length) console.table(rows);
      else console.log("(none)\n");
    };
    await section(
      "Products",
      `select sku, name, karat, weight_grams as grams, approved_price as price, coalesce(stock_status, 'unknown') as stock
         from products order by sku limit $1`,
      [limit],
    );
    const customers = await db.query<{ id: string; full_name: string | null; phone: string | null; email: string | null; identities: string; created_at: Date }>(
      `select c.id, c.full_name, c.phone, c.email, c.created_at,
              coalesce(string_agg(i.identity_type, ',' order by i.identity_type), '') as identities
         from customers c left join customer_identities i on i.customer_id = c.id
        group by c.id order by c.created_at desc limit $1`,
      [limit],
    );
    console.log(`== Customers (${customers.length}) ==`);
    console.table(
      customers.map((c) => ({ id: c.id.slice(0, 8), name: c.full_name ?? "—", phone: mask(c.phone), email: mask(c.email), identities: c.identities, created: c.created_at.toISOString().slice(0, 16) })),
    );
    await section(
      "Leads",
      `select substr(l.id::text, 1, 8) as lead, substr(l.customer_id::text, 1, 8) as customer, l.status, l.score, l.score_classification as class,
              (select string_agg(signal, ',' order by signal) from lead_signal_events e where e.lead_id = l.id) as signals
         from leads l order by l.last_activity_at desc limit $1`,
      [limit],
    );
    await section(
      "Conversations",
      `select substr(c.id::text, 1, 8) as conversation, substr(c.customer_id::text, 1, 8) as customer, c.channel, c.status, c.human_takeover,
              (select count(*)::int from messages m where m.conversation_id = c.id) as messages
         from conversations c order by c.created_at desc limit $1`,
      [limit],
    );
    await section(
      "Product interests",
      `select substr(pi.customer_id::text, 1, 8) as customer, p.sku, pi.interest_type from product_interests pi join products p on p.id = pi.product_id
        order by pi.created_at desc limit $1`,
      [limit],
    );
    await section(
      "Open handoffs",
      `select substr(conversation_id::text, 1, 8) as conversation, reason, urgency, created_at from handoffs where status = 'open' order by created_at desc limit $1`,
      [limit],
    );
    await section(
      "Pending follow-ups",
      `select substr(customer_id::text, 1, 8) as customer, followup_type, scheduled_for from followups where status = 'pending' order by scheduled_for limit $1`,
      [limit],
    );
    await section(
      "Recent audit actions",
      `select action_type, actor_type, status, count(*)::int as n from agent_actions group by 1, 2, 3 order by n desc limit $1`,
      [limit],
    );
    return 0;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
