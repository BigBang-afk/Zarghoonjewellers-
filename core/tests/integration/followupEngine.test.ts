import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptedLlmClient, toolUseBlock } from "../../src/agents/llm/scriptedLlmClient.js";
import { createZarghoonCore } from "../../src/index.js";
import { createClaudeDrafter } from "../../src/services/followupEngine/drafting.js";
import { loadFollowupContext } from "../../src/services/followupEngine/context.js";
import { recommendFollowup } from "../../src/services/followupEngine/recommendations.js";
import { updateFollowupSettings } from "../../src/services/followupEngine/settings.js";
import { createFollowupWorker } from "../../src/services/followupEngine/worker.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { AI_CTX, staffCtx, SYSTEM_CTX } from "../helpers/fixtures.js";
import { at, createWorld, engineWith, key, NOON_PKT, type FollowupWorld } from "../helpers/followupFixtures.js";

let t: TestDatabase;
let w: FollowupWorld;
const engine = (clock = () => NOON_PKT) => engineWith(t.db, clock);
const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(sql, params))[0]!.n;
const schedule = (over: Record<string, unknown> = {}) =>
  engine().scheduleFollowup({ customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key(), ...over } as never, staffCtx(w.ali));

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  w = await createWorld(t.db);
});
afterEach(() => vi.restoreAllMocks());

describe("eligibility and recommendations", () => {
  it("1. eligible: a structured recommendation, then a staff-scheduled follow-up", async () => {
    const ctx = await loadFollowupContext(t.db, w.customer, { now: NOON_PKT });
    const rec = recommendFollowup(ctx);
    expect(rec).toMatchObject({
      customerId: w.customer,
      recommended: true,
      priority: "high", // warm lead (score 25) → normal, bumped one level for a bridal follow-up
      suggestedFollowupType: "bridal",
      requiresStaffReview: true,
      productId: w.necklace,
      blockers: [],
    });
    expect(rec.reason).toMatch(/bridal piece TEST Bridal Necklace \(TEST-NK-001\)/);
    const { followup, created } = await schedule();
    expect(created).toBe(true);
    expect(followup).toMatchObject({ purpose: "bridal", status: "pending", processingState: "scheduled", productId: w.necklace, assignedStaffId: null });
    expect(followup.scheduledFor.getTime()).toBe(NOON_PKT.getTime() + 86_400_000);
  });

  it("2. ineligible: closed sales workflow, no purchase, frequency limit", async () => {
    await createZarghoonCore({ db: t.db }).leads.markLeadLost(w.lead, "TEST — chose elsewhere", staffCtx(w.manager));
    await expect(schedule()).rejects.toMatchObject({ code: "FOLLOWUP_NOT_ALLOWED", reason: "lead_closed" });
    await expect(schedule({ purpose: "post_purchase_care" })).rejects.toMatchObject({ reason: "no_purchase" });
    const rec = recommendFollowup(await loadFollowupContext(t.db, w.customer, { now: NOON_PKT }));
    expect(rec.recommended).toBe(false);
  });

  it("3. do-not-contact: nothing can be scheduled; opting out cancels everything and supersedes drafts", async () => {
    const { followup } = await schedule();
    await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "e1" });
    await createZarghoonCore({ db: t.db }).leads.markLeadDoNotContact(w.lead, staffCtx(w.ali), "TEST — opted out");
    expect((await engine().getFollowup(followup.id)).status).toBe("cancelled");
    expect(await count(`select count(*)::int as n from followup_drafts where status in ('pending_review', 'approved')`)).toBe(0);
    await expect(schedule()).rejects.toMatchObject({ reason: "do_not_contact" });
    await expect(schedule({ purpose: "staff_callback" })).rejects.toMatchObject({ reason: "do_not_contact" });
    const rec = recommendFollowup(await loadFollowupContext(t.db, w.customer, { now: NOON_PKT }));
    expect(rec.recommended).toBe(false);
  });

  it("4. missing consent: no outreach; an internal callback reminder is still allowed; denial cancels", async () => {
    await t.reset();
    w = await createWorld(t.db, () => NOON_PKT, { consent: "unknown" });
    await expect(schedule()).rejects.toMatchObject({ reason: "consent_missing" });
    const callback = await schedule({ purpose: "staff_callback", idempotencyKey: key("cb") });
    expect(callback.created).toBe(true);
    const rec = recommendFollowup(await loadFollowupContext(t.db, w.customer, { now: NOON_PKT }));
    expect(rec).toMatchObject({ recommended: false, blockers: [expect.objectContaining({ code: "consent_missing" })] });

    await engine().setContactConsent(w.customer, "denied", "TEST — customer declined messages", staffCtx(w.ali));
    expect((await engine().getFollowup(callback.followup.id)).status).toBe("cancelled");
    await expect(engine().setContactConsent(w.customer, "granted", "x", staffCtx(w.ali))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("identity under review blocks outreach", async () => {
    await engine().setIdentityReview(w.customer, true, staffCtx(w.manager));
    await expect(schedule()).rejects.toMatchObject({ reason: "identity_review" });
  });
});

describe("5. duplicate prevention", () => {
  it("same idempotency key returns the same follow-up, also under concurrent retries", async () => {
    const k = key("dup");
    const results = await Promise.allSettled([schedule({ idempotencyKey: k }), schedule({ idempotencyKey: k }), schedule({ idempotencyKey: k })]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof schedule>>> => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok.map((r) => r.value.followup.id)).size).toBe(1);
    expect(await count(`select count(*)::int as n from followups where idempotency_key = $1`, [k])).toBe(1);
    expect((await schedule({ idempotencyKey: k })).created).toBe(false);
  });

  it("a second pending sales follow-up for the same lead is refused", async () => {
    await schedule();
    await expect(schedule({ purpose: "price_inquiry" })).rejects.toMatchObject({ code: "DUPLICATE_FOLLOWUP" });
  });

  it("the same drafting event never drafts twice; sequences are idempotent", async () => {
    const { followup } = await schedule();
    const e = engine(() => at(25));
    const [a, b] = await Promise.all([
      e.generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "same" }),
      e.generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "same" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await count(`select count(*)::int as n from followup_drafts`)).toBe(1);

    await t.reset();
    w = await createWorld(t.db);
    const k = key("seq");
    const first = await engine().enrollSequence({ customerId: w.customer, purpose: "bridal", stepDays: [1, 3, 7], idempotencyKey: k }, staffCtx(w.ali));
    const again = await engine().enrollSequence({ customerId: w.customer, purpose: "bridal", stepDays: [1, 3, 7], idempotencyKey: k }, staffCtx(w.ali));
    expect(again).toEqual({ enrollmentId: first.enrollmentId, created: false });
    expect(await count(`select count(*)::int as n from followups`)).toBe(1);
    await expect(engine().enrollSequence({ customerId: w.customer, purpose: "bridal", idempotencyKey: key("seq2") }, staffCtx(w.ali))).rejects.toThrow(/already has an active sequence/);
  });
});

describe("6–8. purchase, reply and takeover", () => {
  it("6. purchase: winning the lead cancels sales follow-ups, supersedes drafts and stops sequences", async () => {
    const seq = await engine().enrollSequence({ customerId: w.customer, purpose: "bridal", idempotencyKey: key("s") }, staffCtx(w.ali));
    const step1 = (await t.db.query<{ id: string }>(`select id from followups where enrollment_id = $1`, [seq.enrollmentId]))[0]!.id;
    await engine(() => at(25)).generateDraft(step1, staffCtx(w.ali), { sourceEventKey: "e" });
    await createZarghoonCore({ db: t.db }).leads.markLeadWon(w.lead, staffCtx(w.ali), "TEST — bought it");
    expect((await engine().getFollowup(step1)).status).toBe("cancelled");
    expect(await count(`select count(*)::int as n from followup_drafts where status = 'superseded'`)).toBe(1);
    expect(await count(`select count(*)::int as n from followup_enrollments where status = 'stopped' and stopped_reason = 'lead_won'`)).toBe(1);
  });

  it("7. customer reply: outstanding outreach is held, drafts withdrawn, staff notified; rescheduling re-arms it", async () => {
    const { followup } = await schedule();
    const draft = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "before-reply" });
    await createZarghoonCore({ db: t.db }).conversations.addMessage({ conversationId: w.conversation, direction: "inbound", senderType: "customer", content: "Is it still there?" }, SYSTEM_CTX);
    const held = await engine().getFollowup(followup.id);
    expect(held).toMatchObject({ processingState: "blocked", blockedReason: "customer_replied", status: "pending" });
    expect(held.customerRepliedAt).toBeInstanceOf(Date);
    expect((await t.db.query<{ status: string }>(`select status from followup_drafts where id = $1`, [draft.id]))[0]!.status).toBe("superseded");
    expect(await count(`select count(*)::int as n from notifications where kind = 'human_attention' and followup_id = $1`, [followup.id])).toBe(1);
    await expect(engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "after-reply" })).rejects.toMatchObject({ reason: "customer_replied" });

    await engine().reschedule(followup.id, at(48).toISOString(), staffCtx(w.ali));
    const summary = await createFollowupWorker(t.db, { clock: () => at(49) }).runOnce();
    expect(summary.drafted).toBe(1);
  });

  it("8. human takeover: no automatic drafting; internal reminders continue; the AI cannot release it", async () => {
    const outreach = await schedule();
    const callback = await schedule({ purpose: "staff_callback", idempotencyKey: key("cb"), assignedStaffId: w.ali });
    await createZarghoonCore({ db: t.db }).handoffs.requestHumanHandoff({ conversationId: w.conversation, reason: "customer_requested" }, AI_CTX);
    await expect(engine(() => at(25)).generateDraft(outreach.followup.id, staffCtx(w.ali), { sourceEventKey: "x" })).rejects.toMatchObject({ reason: "human_takeover" });
    const summary = await createFollowupWorker(t.db, { clock: () => at(25) }).runOnce();
    expect(summary).toMatchObject({ claimed: 2, drafted: 0, held: 1, reminders: 1 });
    expect((await engine().getFollowup(outreach.followup.id)).blockedReason).toBe("human_takeover");
    expect((await engine().getFollowup(callback.followup.id)).processingState).toBe("reminder_due");
    await expect(createZarghoonCore({ db: t.db }).conversations.setHumanTakeover(w.conversation, { active: false }, AI_CTX)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
  });
});

describe("9–11. scheduling, time zone and quiet hours", () => {
  it("9. scheduling rules: past and >365 days refused; high priority notifies; only staff schedule", async () => {
    await expect(schedule({ delayDays: undefined, scheduledFor: at(-1).toISOString() })).rejects.toMatchObject({ reason: "scheduled_in_past" });
    await expect(schedule({ delayDays: 400 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(engine().scheduleFollowup({ customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key() }, AI_CTX)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    const { followup } = await schedule({ priority: "high" });
    expect(await count(`select count(*)::int as n from notifications where kind = 'high_priority_followup' and followup_id = $1`, [followup.id])).toBe(1);
  });

  it("10/11. times are stored in UTC; customer outreach moves out of quiet hours (Asia/Karachi)", async () => {
    // 23:00 PKT → 10:00 PKT next day (05:00Z); stored as a UTC instant.
    const lateNight = new Date(NOON_PKT.getTime() + 11 * 3_600_000);
    const { followup } = await schedule({ delayDays: undefined, scheduledFor: lateNight.toISOString() });
    expect(followup.quietHoursAdjusted).toBe(true);
    expect(followup.scheduledFor.toISOString()).toBe(new Date(NOON_PKT.getTime() + 22 * 3_600_000).toISOString());
    expect(followup.scheduledFor.toISOString().endsWith("05:00:00.000Z")).toBe(true);
    // Internal reminders are not shifted.
    const cb = await schedule({ purpose: "staff_callback", delayDays: undefined, scheduledFor: lateNight.toISOString(), idempotencyKey: key("cb") });
    expect(cb.followup.quietHoursAdjusted).toBe(false);
  });

  it("quiet hours are configurable by the owner/admin only", async () => {
    await expect(updateFollowupSettings(t.db, { quietHoursStart: "22:00" }, staffCtx(w.ali))).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(updateFollowupSettings(t.db, { timezone: "Mars/Olympus" }, staffCtx(w.manager))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const { insertStaff } = await import("../helpers/fixtures.js");
    const owner = await insertStaff(t.db, { fullName: "TEST Owner", role: "owner" });
    const s = await updateFollowupSettings(t.db, { quietHoursEnabled: false, defaultSequenceDays: [2, 5] }, staffCtx(owner));
    expect(s).toMatchObject({ quietHours: { enabled: false }, defaultSequenceDays: [2, 5] });
    const lateNight = new Date(NOON_PKT.getTime() + 11 * 3_600_000);
    expect((await schedule({ delayDays: undefined, scheduledFor: lateNight.toISOString() })).followup.quietHoursAdjusted).toBe(false);
  });
});

describe("12–18. drafts, approval, editing, rescheduling, completion", () => {
  const goodClaude = () =>
    createClaudeDrafter(
      new ScriptedLlmClient(() => () => [
        toolUseBlock("submit_draft", {
          message: "Assalamualaikum TEST Customer! Just following up on the TEST Bridal Necklace you asked about. Would you like to see a few similar designs?",
          language: "english",
          rationale: "Customer asked about the bridal necklace price.",
        }),
      ]),
    );

  it("12/13. AI draft uses only verified facts (approved price present, stock unknown)", async () => {
    const { followup } = await schedule();
    const draft = await engineWith(t.db, () => at(25), goodClaude()).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "ai" });
    expect(draft).toMatchObject({ authorType: "ai", status: "pending_review", version: 1, language: "english" });
    expect(draft.facts).toMatchObject({ products: [{ sku: "TEST-NK-001", price: "PKR 485,000", availability: "needs_confirmation" }] });
    expect((await engine().getFollowup(followup.id)).processingState).toBe("awaiting_review");
  });

  it("14. unknown stock: an availability claim from the model is replaced by the safe template", async () => {
    const { followup } = await schedule();
    const claimsStock = createClaudeDrafter(
      new ScriptedLlmClient(() => () => [toolUseBlock("submit_draft", { message: "Assalamualaikum! The TEST Bridal Necklace is in stock — shall we hold it for you today?", language: "english", rationale: "x" })]),
    );
    const draft = await engineWith(t.db, () => at(25), claimsStock).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "stock" });
    expect(draft.authorType).toBe("template");
    expect(draft.content).not.toMatch(/in stock/i);
    expect((draft.validation as { violations: { code: string }[] }).violations.map((v) => v.code)).toContain("unverified_availability");
  });

  it("15. approval: ready for a future channel — not sent, not completed; decisions are final", async () => {
    const { followup } = await schedule();
    const messagesBefore = await count(`select count(*)::int as n from messages`);
    const draft = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "a" });
    const approved = await engine().approveDraft(draft.id, staffCtx(w.ali), "Looks good");
    expect(approved).toMatchObject({ status: "approved", reviewedByStaffId: w.ali, reviewNote: "Looks good" });
    const f = await engine().getFollowup(followup.id);
    expect(f).toMatchObject({ status: "pending", processingState: "approved" });
    expect(await count(`select count(*)::int as n from messages`)).toBe(messagesBefore);
    await expect(engine().approveDraft(draft.id, staffCtx(w.manager))).rejects.toMatchObject({ reason: "not_reviewable" });
    await expect(engine().approveDraft(draft.id, AI_CTX)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
  });

  it("15b. rejection, and approval blocked after an opt-out", async () => {
    const { followup } = await schedule();
    const d1 = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "r1" });
    await engine().rejectDraft(d1.id, staffCtx(w.ali), "Too formal");
    expect((await engine().getFollowup(followup.id)).processingState).toBe("awaiting_review");
    const d2 = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "r2" });
    expect(d2.version).toBe(2);
    await t.db.query(`update customers set contact_consent = 'unknown' where id = $1`, [w.customer]);
    await expect(engine().approveDraft(d2.id, staffCtx(w.ali))).rejects.toMatchObject({ reason: "consent_missing" });
  });

  it("16. editing creates a staff-authored version that still needs approval; prohibited content is refused", async () => {
    const { followup } = await schedule();
    const d1 = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "e" });
    const req = key("edit");
    const edited = await engine().editDraft(
      { followupId: followup.id, content: "Assalamualaikum! Ali here from Zarghoon Jewellers — would you like to visit this Saturday to see the TEST Bridal Necklace?", language: "english", eventKey: req },
      staffCtx(w.ali),
    );
    expect(edited).toMatchObject({ version: 2, authorType: "staff", authorStaffId: w.ali, status: "pending_review" });
    expect((await t.db.query<{ status: string }>(`select status from followup_drafts where id = $1`, [d1.id]))[0]!.status).toBe("superseded");
    const repeat = await engine().editDraft({ followupId: followup.id, content: "different", language: "english", eventKey: req }, staffCtx(w.ali));
    expect(repeat.id).toBe(edited.id); // double-submit is harmless
    await expect(
      engine().editDraft({ followupId: followup.id, content: "Assalamualaikum! Special 20% discount this week only!", language: "english", eventKey: key() }, staffCtx(w.ali)),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("17. rescheduling moves the time (quiet hours applied), withdraws drafts and re-arms processing", async () => {
    const { followup } = await schedule();
    await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "e" });
    const moved = await engine().reschedule(followup.id, new Date(NOON_PKT.getTime() + 35 * 3_600_000).toISOString(), staffCtx(w.ali)); // 23:00 PKT
    expect(moved).toMatchObject({ processingState: "scheduled", quietHoursAdjusted: true, processingAttempts: 0 });
    expect(await count(`select count(*)::int as n from followup_drafts where status = 'superseded'`)).toBe(1);
    await expect(engine().reschedule(followup.id, at(-2).toISOString(), staffCtx(w.ali))).rejects.toMatchObject({ reason: "scheduled_in_past" });
  });

  it("18. completion is a staff decision; it advances a sequence to the next step", async () => {
    const seq = await engine().enrollSequence({ customerId: w.customer, purpose: "bridal", stepDays: [1, 3, 7], idempotencyKey: key("seq") }, staffCtx(w.ali));
    const step1 = (await t.db.query<{ id: string }>(`select id from followups where enrollment_id = $1`, [seq.enrollmentId]))[0]!.id;
    await engine(() => at(25)).generateDraft(step1, staffCtx(w.ali), { sourceEventKey: "e" });
    expect((await engine().getFollowup(step1)).status).toBe("pending"); // a draft never completes it
    await engine(() => at(26)).complete(step1, "Called the customer", staffCtx(w.ali));
    expect((await engine().getFollowup(step1)).status).toBe("completed");
    const steps = await t.db.query<{ sequence_step: number; status: string }>(`select sequence_step, status from followups where enrollment_id = $1 order by sequence_step`, [seq.enrollmentId]);
    expect(steps).toEqual([{ sequence_step: 1, status: "completed" }, { sequence_step: 2, status: "pending" }]);
    await expect(engine().generateDraft(step1, staffCtx(w.ali), { sourceEventKey: "late" })).rejects.toMatchObject({ reason: "not_pending" });
  });
});

describe("22/25. audit trail and no external messages", () => {
  it("every step is audited (without message text) and nothing leaves the system", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const messagesBefore = await count(`select count(*)::int as n from messages`);
    const { followup } = await schedule({ priority: "high" });
    const draft = await engine(() => at(25)).generateDraft(followup.id, staffCtx(w.ali), { sourceEventKey: "aud" });
    await engine().approveDraft(draft.id, staffCtx(w.manager));
    await engine().reschedule(followup.id, at(72).toISOString(), staffCtx(w.ali));
    await createFollowupWorker(t.db, { clock: () => at(73) }).runOnce();
    const actions = (await t.db.query<{ action_type: string }>(`select action_type from agent_actions order by created_at, id`)).map((a) => a.action_type);
    expect(actions).toEqual(
      expect.arrayContaining([
        "contact_consent_updated",
        "followup_engine_scheduled",
        "followup_draft_generated",
        "followup_draft_approved",
        "followup_rescheduled",
        "followup_worker_run",
      ]),
    );
    const drafted = await t.db.query<{ input: unknown; output: unknown }>(`select input, output from agent_actions where action_type = 'followup_draft_generated'`);
    expect(JSON.stringify(drafted)).not.toContain("Assalamualaikum");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await count(`select count(*)::int as n from messages`)).toBe(messagesBefore);
  });
});
