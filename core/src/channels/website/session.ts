import { createHash, randomBytes } from "node:crypto";

/**
 * Website chat sessions.
 *
 * The browser holds an opaque random token in an HttpOnly cookie. The server
 * never trusts customer or conversation IDs from the browser: it derives the
 * customer from the token. Only the SHA-256 hash of the token is stored (as a
 * `website_visitor` identity), so a database leak does not reveal live
 * session tokens.
 */

export const SESSION_COOKIE_NAME = "zj_chat_sid";
/** 32 random bytes, base64url-encoded → 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Returns the token if it is well-formed, otherwise null (treated as a new visitor). */
export function parseSessionToken(raw: string | null | undefined): string | null {
  return raw && TOKEN_PATTERN.test(raw) ? raw : null;
}

/** The value stored as the customer's `website_visitor` identity. */
export function sessionIdentityValue(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

