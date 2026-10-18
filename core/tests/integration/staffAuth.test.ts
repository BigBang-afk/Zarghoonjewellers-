import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createStaffAuthService,
  hashSessionToken,
  LOCKOUT_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
} from "../../src/services/staffAuth/staffAuthService.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { AI_CTX, insertStaff, staffCtx, SYSTEM_CTX } from "../helpers/fixtures.js";

const PASSWORD = "correct-horse-42-battery";
let t: TestDatabase;
let now: Date;
let staffId: string;
const clock = () => now;
const auth = () => createStaffAuthService(t.db, clock);

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  now = new Date("2026-10-19T09:00:00Z");
  staffId = await insertStaff(t.db, { fullName: "Test Owner", role: "owner" });
  await auth().setCredential({ staffId, username: "Owner.One", password: PASSWORD }, SYSTEM_CTX);
});

describe("staff sign-in", () => {
  it("signs in, stores only hashes, and resolves the session", async () => {
    const r = await auth().login({ username: "owner.one", password: PASSWORD });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [cred] = await t.db.query<{ password_hash: string; username: string }>(`select password_hash, username from staff_credentials`);
    expect(cred!.username).toBe("owner.one");
    expect(cred!.password_hash).toMatch(/^scrypt\$/);
    expect(cred!.password_hash).not.toContain(PASSWORD);
    const [session] = await t.db.query<{ token_hash: string }>(`select token_hash from staff_sessions`);
    expect(session!.token_hash).toBe(hashSessionToken(r.token));
    expect(session!.token_hash).not.toBe(r.token);
    expect(await auth().getSession(r.token)).toMatchObject({ staff: { id: staffId, role: "owner" }, username: "owner.one" });
    expect(await auth().getSession("not-a-token")).toBeNull();
  });

  it("gives the same answer for unknown users and wrong passwords, and never logs passwords", async () => {
    expect(await auth().login({ username: "nobody", password: PASSWORD })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await auth().login({ username: "owner.one", password: "wrong-password-1" })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await auth().login({ username: "x", password: 42 })).toEqual({ ok: false, reason: "invalid_credentials" });
    const audit = await t.db.query<{ input: unknown }>(`select input from agent_actions where action_type = 'staff_login_failed'`);
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain("wrong-password-1");
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it("locks the account after 5 failures, then unlocks after 15 minutes", async () => {
    for (let i = 0; i < 4; i++) expect((await auth().login({ username: "owner.one", password: "bad-password-9" })).ok).toBe(false);
    expect(await auth().login({ username: "owner.one", password: "bad-password-9" })).toEqual({ ok: false, reason: "locked" });
    // Even the right password is refused while locked.
    expect(await auth().login({ username: "owner.one", password: PASSWORD })).toEqual({ ok: false, reason: "locked" });
    now = new Date(now.getTime() + LOCKOUT_MS + 1000);
    expect((await auth().login({ username: "owner.one", password: PASSWORD })).ok).toBe(true);
  });

  it("ends sessions on idle timeout, absolute expiry, sign-out and deactivation", async () => {
    const login = async () => {
      const r = await auth().login({ username: "owner.one", password: PASSWORD });
      if (!r.ok) throw new Error("login failed");
      return r.token;
    };
    const start = now;
    let token = await login();
    now = new Date(start.getTime() + SESSION_IDLE_MS + 1000);
    expect(await auth().getSession(token)).toBeNull();

    // Active use keeps it alive, but never beyond the absolute limit.
    now = start;
    token = await login();
    for (let h = 1; h <= 11; h++) {
      now = new Date(start.getTime() + h * 3_600_000);
      expect(await auth().getSession(token)).not.toBeNull();
    }
    now = new Date(start.getTime() + SESSION_MAX_MS + 1000);
    expect(await auth().getSession(token)).toBeNull();

    now = start;
    token = await login();
    await auth().logout(token);
    expect(await auth().getSession(token)).toBeNull();

    token = await login();
    await t.db.query(`update staff set is_active = false where id = $1`, [staffId]);
    expect(await auth().getSession(token)).toBeNull();
    expect((await auth().login({ username: "owner.one", password: PASSWORD })).ok).toBe(false);
  });

  it("only the system, owners and admins manage sign-in; the AI never", async () => {
    const sales = await insertStaff(t.db, { fullName: "Sales Person", role: "sales" });
    const input = { staffId: sales, username: "sales.one", password: PASSWORD };
    await expect(auth().setCredential(input, staffCtx(sales))).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(auth().setCredential(input, AI_CTX)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(auth().setCredential({ ...input, password: "short1" }, staffCtx(staffId))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(auth().setCredential({ ...input, username: "owner.one" }, staffCtx(staffId))).rejects.toThrow(/already in use/);
    await expect(auth().setCredential(input, staffCtx(staffId))).resolves.toMatchObject({ username: "sales.one" });
  });

  it("changing a password needs the current one and signs out every session", async () => {
    const r = await auth().login({ username: "owner.one", password: PASSWORD });
    if (!r.ok) throw new Error("login failed");
    const session = (await auth().getSession(r.token))!;
    await expect(auth().changeOwnPassword(session, "wrong-current-1", "new-password-123")).rejects.toThrow(/incorrect/);
    await auth().changeOwnPassword(session, PASSWORD, "new-password-123");
    expect(await auth().getSession(r.token)).toBeNull();
    expect((await auth().login({ username: "owner.one", password: "new-password-123" })).ok).toBe(true);
  });
});
