import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenActionError, InvalidStateError, ValidationError } from "../../src/lib/errors.js";
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
});
