import { createHash } from "node:crypto";

/**
 * Passwords that were published (e.g. the old seeded demo admin password,
 * which appeared in the README and seed output). They are stored here only
 * as SHA-256 hashes so the plaintext is not repeated in the codebase.
 * Any account using one of them is refused at sign-in until its password is
 * rotated (see README → "Admin account").
 */
const BLOCKED_PASSWORD_SHA256 = new Set<string>([
  "ddfa08f04ffbedd937ce079026ead9826c0f4572feee5e45ff2a66d058c0c9d5",
]);

export function isBlockedPassword(password: string): boolean {
  return BLOCKED_PASSWORD_SHA256.has(createHash("sha256").update(password).digest("hex"));
}
