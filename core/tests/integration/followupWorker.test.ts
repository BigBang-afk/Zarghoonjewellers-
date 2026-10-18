import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LlmProviderError } from "../../src/agents/llm/llmClient.js";
import type { Db } from "../../src/database/db.js";
import { createTemplateDrafter, type FollowupDrafter } from "../../src/services/followupEngine/drafting.js";
import { createFollowupWorker } from "../../src/services/followupEngine/worker.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { staffCtx } from "../helpers/fixtures.js";
import { at, createWorld, engineWith, key, type FollowupWorld } from "../helpers/followupFixtures.js";

let t: TestDatabase;
let w: FollowupWorld;
const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(sql, params))[0]!.n;
const scheduleDueTomorrow = (over: Record<string, unknown> = {}) =>
  engineWith(t.db).scheduleFollowup({ customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key(), ...over } as never, staffCtx(w.ali));
const worker = (hours: number, drafter?: FollowupDrafter, db: Db = t.db, workerId?: string) =>
  createFollowupWorker(db, { clock: () => at(hours), drafter, workerId });

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  w = await createWorld(t.db);
});

describe("follow-up worker", () => {
  it("processes only what is due, drafts once, and never completes the follow-up", async () => {
    const { followup } = await scheduleDueTomorrow();
    expect((await worker(1).runOnce()).claimed).toBe(0); // not due yet
    const s = await worker(25).runOnce();
    expect(s).toMatchObject({ claimed: 1, drafted: 1, failed: 0 });
    expect(await count(`select count(*)::int as n from followup_drafts where followup_id = $1`, [followup.id])).toBe(1);
    const f = (await t.db.query<{ status: string; processing_state: string }>(`select status, processing_state from followups where id = $1`, [followup.id]))[0]!;
    expect(f).toEqual({ status: "pending", processing_state: "awaiting_review" });
    expect((await worker(26).runOnce()).claimed).toBe(0); // awaiting review is not re-processed
  });

  it("re-checks eligibility: a purchase recorded after scheduling cancels the sales follow-up", async () => {
    const { followup } = await scheduleDueTomorrow();
    await t.db.query(
      `insert into orders (order_number, customer_id, status, payment_status, subtotal, total, confirmed_at) values ('TEST-ORD-1', $1, 'confirmed', 'paid', 1000, 1000, now())`,
      [w.customer],
    );
    const s = await worker(25).runOnce();
    expect(s).toMatchObject({ claimed: 1, cancelled: 1, drafted: 0 });
    expect((await t.db.query<{ status: string; blocked_reason: string }>(`select status, blocked_reason from followups where id = $1`, [followup.id]))[0]).toEqual({
      status: "cancelled",
      blocked_reason: "lead_closed",
    });
  });

  it("consent withdrawn to unknown: held for staff, not cancelled", async () => {
    await scheduleDueTomorrow();
    await t.db.query(`update customers set contact_consent = 'unknown' where id = $1`, [w.customer]);
    expect(await worker(25).runOnce()).toMatchObject({ held: 1, drafted: 0, cancelled: 0 });
  });

  it("19. bounded retries with back-off, safe error codes, and a notification when exhausted", async () => {
    const { followup } = await scheduleDueTomorrow();
    let calls = 0;
    const flaky: FollowupDrafter = {
      kind: "ai",
      model: "test",
      draft: async (facts) => {
        calls++;
        if (calls <= 3) throw new LlmProviderError("provider down (secret-token-xyz)", true);
        return createTemplateDrafter().draft(facts);
      },
    };
    expect(await worker(25, flaky).runOnce()).toMatchObject({ claimed: 1, failed: 1 });
    let f = (await t.db.query<Record<string, any>>(`select * from followups where id = $1`, [followup.id]))[0]!;
    expect(f).toMatchObject({ processing_state: "failed", last_error_code: "LLM_PROVIDER_RETRYABLE", processing_attempts: 1 });
    expect((await worker(25, flaky).runOnce()).claimed).toBe(0); // back-off not over
    expect(await worker(25.1, flaky).runOnce()).toMatchObject({ claimed: 1, failed: 1 }); // after 1 min
    expect(await worker(25.3, flaky).runOnce()).toMatchObject({ claimed: 1, failed: 1, exhausted: 1 }); // after 5 min — 3rd and last attempt
    expect((await worker(30, flaky).runOnce()).claimed).toBe(0); // exhausted: staff must reschedule
    expect(await count(`select count(*)::int as n from notifications where kind = 'processing_failed' and followup_id = $1`, [followup.id])).toBe(1);
    const audit = await t.db.query(`select error_message, output from agent_actions where action_type = 'followup_processing_failed'`);
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain("secret-token-xyz");

    // Staff reschedule → attempts reset → the next (now healthy) run succeeds.
    await engineWith(t.db, () => at(30)).reschedule(followup.id, at(31).toISOString(), staffCtx(w.ali));
    expect(await worker(32, flaky).runOnce()).toMatchObject({ drafted: 1, failed: 0 });
    f = (await t.db.query<Record<string, any>>(`select * from followups where id = $1`, [followup.id]))[0]!;
    expect(f).toMatchObject({ processing_state: "awaiting_review", last_error_code: null });
  });

  it("20. concurrent workers: every due follow-up is processed exactly once", async () => {
    const extra = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const { createZarghoonCore } = await import("../../src/index.js");
        const core = createZarghoonCore({ db: t.db });
        const { customer } = await core.customers.createCustomer({ fullName: `TEST Bulk ${i}`, email: `bulk${i}@example.invalid` }, { actor: { type: "system" } });
        await engineWith(t.db).setContactConsent(customer.id, "granted", "TEST bulk", staffCtx(w.manager));
        return customer.id;
      }),
    );
    await scheduleDueTomorrow();
    for (const c of extra) await engineWith(t.db).scheduleFollowup({ customerId: c, purpose: "new_inquiry", delayDays: 1, idempotencyKey: key() }, staffCtx(w.manager));
    const results = await Promise.all([1, 2, 3].map((n) => worker(25, undefined, t.db, `w${n}`).runOnce({ limit: 4 })));
    // Three workers race for six due follow-ups: each is claimed and drafted exactly once.
    expect(results.reduce((s, r) => s + r.claimed, 0)).toBe(6);
    expect(await count(`select count(*)::int as n from followup_drafts`)).toBe(6);
    expect(await count(`select count(*)::int as n from (select followup_id from followup_drafts group by 1 having count(*) > 1) x`)).toBe(0);
  });

  it("21. database failure: recorded as a failure, no crash; a stuck lease is recovered", async () => {
    const { followup } = await scheduleDueTomorrow();
    // A database whose draft inserts fail.
    const failingInserts: Db = {
      query: (sql, params) => (/insert into followup_drafts/.test(sql) ? Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })) : t.db.query(sql, params)),
      exec: (sql) => t.db.exec(sql),
      transaction: (fn) => t.db.transaction((tx) => fn({ ...tx, query: (sql: string, p?: readonly unknown[]) => (/insert into followup_drafts/.test(sql) ? Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })) : tx.query(sql, p)), exec: (s: string) => tx.exec(s), transaction: tx.transaction.bind(tx) } as Db)),
    };
    const s = await worker(25, undefined, failingInserts).runOnce();
    expect(s).toMatchObject({ claimed: 1, failed: 1 });
    expect((await t.db.query<{ last_error_code: string }>(`select last_error_code from followups where id = $1`, [followup.id]))[0]!.last_error_code).toBe("DB_53100");

    // A worker that dies after claiming (every write fails): the lease expires and another worker finishes the job.
    await t.reset();
    w = await createWorld(t.db);
    const second = await scheduleDueTomorrow();
    let claimed = false;
    const dying: Db = {
      query: async (sql, params) => {
        if (claimed) throw new Error("connection lost");
        return t.db.query(sql, params);
      },
      exec: (sql) => t.db.exec(sql),
      transaction: async (fn) => {
        if (claimed) throw new Error("connection lost");
        const r = await t.db.transaction(fn);
        claimed = true; // the claim committed, then the database "goes away"
        return r;
      },
    };
    await expect(worker(25, undefined, dying).runOnce()).resolves.toMatchObject({ claimed: 1 });
    expect((await t.db.query<{ processing_state: string }>(`select processing_state from followups where id = $1`, [second.followup.id]))[0]!.processing_state).toBe("processing");
    expect((await worker(25.05).runOnce()).claimed).toBe(0); // lease still held
    expect(await worker(25.2).runOnce()).toMatchObject({ claimed: 1, drafted: 1 }); // lease expired (5 min) → recovered
  });
});
