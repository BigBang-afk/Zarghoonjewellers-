import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApprovalRequiredError, ForbiddenActionError, InvalidStateError, ValidationError } from "../../src/lib/errors.js";
import { assertUsableApproval } from "../../src/services/approvalService.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertStaff, staffCtx } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("approvals", () => {
  it("lets the AI request but only approver roles decide", async () => {
    const sales = await insertStaff(t.db, { role: "sales" });
    const owner = await insertStaff(t.db, { role: "owner" });
    const req = await core.approvals.createApprovalRequest(
      { actionType: "discount", reason: "Customer asked for 5% off bridal set", payload: { percent: "5" } },
      AI_CTX,
    );
    expect(req).toMatchObject({ status: "pending", requestedByType: "ai" });
    await expect(core.approvals.approve(req.id, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    await expect(core.approvals.approve(req.id, staffCtx(sales))).rejects.toBeInstanceOf(ForbiddenActionError);
    const approved = await core.approvals.approve(req.id, staffCtx(owner), "OK for repeat customer");
    expect(approved).toMatchObject({ status: "approved", decidedByStaffId: owner, decisionNote: "OK for repeat customer" });
    await expect(core.approvals.reject(req.id, staffCtx(owner))).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("supports rejection, cancellation and listing pending", async () => {
    const manager = await insertStaff(t.db, { role: "manager" });
    const a = await core.approvals.createApprovalRequest({ actionType: "refund", reason: "Damaged clasp" }, AI_CTX);
    const b = await core.approvals.createApprovalRequest({ actionType: "bulk_marketing", reason: "Eid campaign" }, AI_CTX);
    expect((await core.approvals.listPendingApprovals()).map((x) => x.id)).toEqual([a.id, b.id]);
    expect((await core.approvals.reject(a.id, staffCtx(manager), "Needs inspection")).status).toBe("rejected");
    expect((await core.approvals.cancelApproval(b.id, AI_CTX)).status).toBe("cancelled");
    expect(await core.approvals.listPendingApprovals()).toEqual([]);
  });

  it("validates action types", async () => {
    await expect(core.approvals.createApprovalRequest({ actionType: "free_gold", reason: "x" } as never, AI_CTX)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  describe("step 12: replay, concurrency and tampering", () => {
    async function approvedRequest(actionType: "discount" | "price_change" = "discount") {
      const owner = await insertStaff(t.db, { role: "owner" });
      const req = await core.approvals.createApprovalRequest({ actionType, reason: "Test approval", payload: { percent: "5" } }, AI_CTX);
      await core.approvals.approve(req.id, staffCtx(owner));
      return { id: req.id, owner };
    }

    it("an approval is consumed once; a replay is refused", async () => {
      const { id } = await approvedRequest();
      const used = await t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount"));
      expect(used.consumedByAction).toBe("apply_discount");
      expect(used.consumedAt).toBeInstanceOf(Date);
      await expect(t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount"))).rejects.toThrow(/already been used/);
      // Nor can it be reused for a different kind of action.
      await expect(t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "other_consumer"))).rejects.toBeInstanceOf(ApprovalRequiredError);
    });

    it("a failed action does not use up the approval (consumption rolls back)", async () => {
      const { id } = await approvedRequest();
      await expect(
        t.db.transaction(async (tx) => {
          await assertUsableApproval(tx, id, "discount", "apply_discount");
          throw new Error("action failed");
        }),
      ).rejects.toThrow("action failed");
      expect((await core.approvals.getApproval(id)).consumedAt).toBeNull();
      await t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount"));
    });

    it("two simultaneous uses: exactly one succeeds", async () => {
      const { id } = await approvedRequest();
      const results = await Promise.allSettled([
        t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount")),
        t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount")),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });

    it("two staff deciding at the same time: one decision wins, the other is refused", async () => {
      const owner = await insertStaff(t.db, { role: "owner" });
      const manager = await insertStaff(t.db, { role: "manager" });
      const req = await core.approvals.createApprovalRequest({ actionType: "refund", reason: "Damaged clasp" }, AI_CTX);
      const results = await Promise.allSettled([core.approvals.approve(req.id, staffCtx(owner)), core.approvals.reject(req.id, staffCtx(manager))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(InvalidStateError);
    });

    it("unapproved, rejected, wrong-type and support/sales/AI approvals cannot be used", async () => {
      const support = await insertStaff(t.db, { role: "support" });
      const req = await core.approvals.createApprovalRequest({ actionType: "discount", reason: "x" }, AI_CTX);
      await expect(t.db.transaction((tx) => assertUsableApproval(tx, req.id, "discount", "apply_discount"))).rejects.toThrow(/pending/);
      await expect(core.approvals.approve(req.id, staffCtx(support))).rejects.toBeInstanceOf(ForbiddenActionError);
      const { id } = await approvedRequest("price_change");
      await expect(t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount"))).rejects.toThrow(/not "discount"/);
    });

    it("the database refuses edits to a decided approval, even from a privileged connection", async () => {
      const { id } = await approvedRequest();
      const tamper = (sql: string) => t.db.query(sql, [id]);
      await expect(tamper(`update approvals set status = 'pending', decided_at = null where id = $1`)).rejects.toThrow(/final/);
      await expect(tamper(`update approvals set payload = '{"percent":"50"}' where id = $1`)).rejects.toThrow(/cannot be changed/);
      await expect(tamper(`update approvals set action_type = 'refund' where id = $1`)).rejects.toThrow(/cannot be changed/);
      await expect(tamper(`delete from approvals where id = $1`)).rejects.toThrow(/cannot be deleted/);
      await t.db.transaction((tx) => assertUsableApproval(tx, id, "discount", "apply_discount"));
      await expect(tamper(`update approvals set consumed_at = null, consumed_by_action = null where id = $1`)).rejects.toThrow(/already been used/);
      // A pending request's details are fixed too: what is approved is what was asked.
      const pending = await core.approvals.createApprovalRequest({ actionType: "discount", reason: "x", payload: { percent: "5" } }, AI_CTX);
      await expect(t.db.query(`update approvals set payload = '{"percent":"50"}' where id = $1`, [pending.id])).rejects.toThrow(/cannot be changed/);
      // Consuming a non-approved request is refused by the database as well.
      await expect(t.db.query(`update approvals set consumed_at = now(), consumed_by_action = 'x' where id = $1`, [pending.id])).rejects.toThrow(
        /approvals_consumption_consistency/,
      );
    });
  });
});
