import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { z } from "zod";
import { isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import { ForbiddenActionError, InvalidStateError, StaffNotFoundError, ValidationError } from "../../lib/errors.js";
import { parseInput, uuidSchema } from "../../lib/validation.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { findStaff, mapStaffRow, requireStaffActor, type StaffSummary } from "../staffRules.js";

/**
 * Staff sign-in for the management dashboard.
 *
 *  - Passwords: scrypt (N=2^15, r=8, p=1) with a random salt; verified in
 *    constant time. Unknown usernames are verified against a dummy hash so
 *    response time does not reveal which accounts exist.
 *  - Lockout: 5 consecutive failures lock the account for 15 minutes.
 *  - Sessions: 32 random bytes, stored only as a SHA-256 hash. A session ends
 *    after 2 hours idle or 12 hours in total, on sign-out, on a password
 *    change, or as soon as the staff member is deactivated.
 */

export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
/** last_seen_at is refreshed at most this often, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60 * 1000;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 };

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, "Username: 3–40 characters, letters, numbers, '.', '_' or '-'");

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200, "Password is too long")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A fixed hash used to spend the same time on unknown usernames. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(18).toString("base64")));

export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | { ok: true; token: string; staff: StaffSummary; expiresAt: Date }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export interface StaffSession {
  sessionId: string;
  staff: StaffSummary;
  username: string;
  expiresAt: Date;
}

interface CredentialRow {
  staff_id: string;
  username: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
}

export function createStaffAuthService(db: Db, clock: Clock = systemClock) {
  async function login(input: { username: unknown; password: unknown; userAgent?: string | null }): Promise<LoginResult> {
    const username = usernameSchema.safeParse(input.username);
    const password = typeof input.password === "string" && input.password.length <= 200 ? input.password : null;
    const now = clock();
    const row =
      username.success && password !== null
        ? await queryOne<CredentialRow & { is_active: boolean }>(
            db,
            `select c.staff_id, c.username, c.password_hash, c.failed_attempts, c.locked_until, s.is_active
               from staff_credentials c join staff s on s.id = c.staff_id where c.username = $1`,
            [username.data],
          )
        : null;

    const valid = await verifyPassword(password ?? "", row?.password_hash ?? (await getDummyHash()));
    const loginCtx: ActionContext = { actor: { type: "system", name: "dashboard_login" } };

    if (!row || password === null) {
      await recordAction(db, loginCtx, {
        actionType: "staff_login_failed",
        status: "failed",
        input: { username: username.success ? username.data : "(invalid)" },
      });
      return { ok: false, reason: "invalid_credentials" };
    }
    if (row.locked_until && row.locked_until.getTime() > now.getTime()) {
      await recordAction(db, loginCtx, { actionType: "staff_login_locked", status: "failed", input: { username: row.username } });
      return { ok: false, reason: "locked" };
    }
    if (!valid || !row.is_active) {
      const attempts = row.failed_attempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null;
      await db.query(
        `update staff_credentials set failed_attempts = $2, locked_until = $3 where staff_id = $1`,
        [row.staff_id, lock ? 0 : attempts, lock],
      );
      await recordAction(db, loginCtx, {
        actionType: "staff_login_failed",
        status: "failed",
        input: { username: row.username },
        output: { locked: lock !== null, inactive: !row.is_active },
      });
      return { ok: false, reason: lock ? "locked" : "invalid_credentials" };
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_MAX_MS);
    return db.transaction(async (tx) => {
      await tx.query(
        `update staff_credentials set failed_attempts = 0, locked_until = null, last_login_at = $2 where staff_id = $1`,
        [row.staff_id, now],
      );
      await tx.query(
        `insert into staff_sessions (token_hash, staff_id, created_at, last_seen_at, expires_at, user_agent)
         values ($1, $2, $3, $3, $4, $5)`,
        [hashSessionToken(token), row.staff_id, now, expiresAt, input.userAgent?.slice(0, 300) ?? null],
      );
      await recordAction(tx, { actor: { type: "staff", staffId: row.staff_id } }, { actionType: "staff_login" });
      return { ok: true as const, token, staff: (await findStaff(tx, row.staff_id))!, expiresAt };
    });
  }

  /** Resolves a session token to an active staff member, or null. */
  async function getSession(token: string | null | undefined): Promise<StaffSession | null> {
    if (!token || token.length > 100) return null;
    const now = clock();
    const row = await queryOne<{
      session_id: string;
      last_seen_at: Date;
      expires_at: Date;
      username: string;
      id: string;
      full_name: string;
      role: StaffSummary["role"];
      is_active: boolean;
      is_available: boolean;
    }>(
      db,
      `select ss.id as session_id, ss.last_seen_at, ss.expires_at, c.username,
              s.id, s.full_name, s.role, s.is_active, s.is_available
         from staff_sessions ss
         join staff s on s.id = ss.staff_id
         join staff_credentials c on c.staff_id = s.id
        where ss.token_hash = $1 and ss.revoked_at is null`,
      [hashSessionToken(token)],
    );
    if (!row || !row.is_active) return null;
    if (row.expires_at.getTime() <= now.getTime()) return null;
    if (now.getTime() - row.last_seen_at.getTime() > SESSION_IDLE_MS) return null;
    if (now.getTime() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await db.query(`update staff_sessions set last_seen_at = $2 where id = $1`, [row.session_id, now]);
    }
    return { sessionId: row.session_id, staff: mapStaffRow(row), username: row.username, expiresAt: row.expires_at };
  }

  async function logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    const rows = await db.query<{ staff_id: string }>(
      `update staff_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning staff_id`,
      [hashSessionToken(token), clock()],
    );
    if (rows[0]) await recordAction(db, { actor: { type: "staff", staffId: rows[0].staff_id } }, { actionType: "staff_logout" });
  }

  async function revokeAllSessions(staffId: string, tx: Db = db): Promise<number> {
    const rows = await tx.query(`update staff_sessions set revoked_at = $2 where staff_id = $1 and revoked_at is null returning id`, [
      staffId,
      clock(),
    ]);
    return rows.length;
  }

  /**
   * Creates or replaces a staff member's sign-in. Allowed for the system
   * (the owner's setup CLI) and for owner/admin staff. Ends every existing
   * session of that staff member.
   */
  async function setCredential(input: { staffId: string; username: string; password: string }, ctx: ActionContext) {
    const staffId = parseInput(uuidSchema, input.staffId, "staff id");
    const username = parseInput(usernameSchema, input.username, "username");
    const password = parseInput(passwordSchema, input.password, "password");
    if (ctx.actor.type === "ai") throw new ForbiddenActionError("The AI may not manage staff sign-in");
    const passwordHash = await hashPassword(password);
    try {
      return await db.transaction(async (tx) => {
        if (ctx.actor.type === "staff") await requireStaffActor(tx, ctx, "manage staff sign-in", ["owner", "admin"]);
        const staff = await findStaff(tx, staffId);
        if (!staff) throw new StaffNotFoundError({ id: staffId });
        await tx.query(
          `insert into staff_credentials (staff_id, username, password_hash) values ($1, $2, $3)
           on conflict (staff_id) do update set username = excluded.username, password_hash = excluded.password_hash,
             password_updated_at = now(), failed_attempts = 0, locked_until = null`,
          [staffId, username, passwordHash],
        );
        const revoked = await revokeAllSessions(staffId, tx);
        await recordAction(tx, ctx, {
          actionType: "staff_credential_set",
          input: { staffId, username },
          output: { revokedSessions: revoked },
        });
        return { staff, username };
      });
    } catch (error) {
      if (isUniqueViolation(error, "staff_credentials_username_key")) {
        throw new ValidationError("That username is already in use", [{ path: "username", message: "already in use" }]);
      }
      throw error;
    }
  }

  /** A signed-in staff member changes their own password (current password required). */
  async function changeOwnPassword(session: StaffSession, currentPassword: string, newPassword: string): Promise<void> {
    const next = parseInput(passwordSchema, newPassword, "new password");
    const row = await queryOne<{ password_hash: string }>(
      db,
      `select password_hash from staff_credentials where staff_id = $1`,
      [session.staff.id],
    );
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw new InvalidStateError("Current password is incorrect");
    }
    const hash = await hashPassword(next);
    await db.transaction(async (tx) => {
      await tx.query(`update staff_credentials set password_hash = $2, password_updated_at = now() where staff_id = $1`, [
        session.staff.id,
        hash,
      ]);
      const revoked = await revokeAllSessions(session.staff.id, tx);
      await recordAction(tx, { actor: { type: "staff", staffId: session.staff.id } }, {
        actionType: "staff_password_changed",
        output: { revokedSessions: revoked },
      });
    });
  }

  return { login, getSession, logout, revokeAllSessions: (staffId: string) => revokeAllSessions(staffId), setCredential, changeOwnPassword };
}

export type StaffAuthService = ReturnType<typeof createStaffAuthService>;
