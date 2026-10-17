/**
 * Secret redaction for anything persisted to the audit log or written to logs.
 */

// Matched against whole key tokens (camelCase/snake_case/kebab-case split), so
// "shipping" is not mistaken for "pin" but "api_key", "apiKey" and
// "refreshToken" are all caught.
const SECRET_KEY_TOKENS = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "apikey",
  "authorization",
  "auth",
  "cookie",
  "credential",
  "credentials",
  "otp",
  "pin",
  "cvv",
]);
const SECRET_KEY_PHRASES = ["api_key", "private_key", "service_role", "session_id", "client_secret"];

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Values that look like credentials even under an innocent key. */
const SECRET_VALUE_PATTERN =
  /(sk-ant-[A-Za-z0-9_-]{8,}|sk_(live|test)_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|postgres(ql)?:\/\/[^\s:]+:[^\s@]+@)/;

export const REDACTED = "[REDACTED]";

export function isSecretKey(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((t) => SECRET_KEY_TOKENS.has(t))) return true;
  const joined = tokens.join("_");
  return SECRET_KEY_PHRASES.some((phrase) => joined.includes(phrase));
}

export function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value);
}

/** Deep-copies a JSON-like value with secret-looking keys and values masked. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return looksLikeSecretValue(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Returns the dotted paths of secret-looking keys/values (used to reject message metadata). */
export function findSecrets(value: unknown, path = "", depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return looksLikeSecretValue(value) ? [path || "(root)"] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecrets(v, `${path}[${i}]`, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = path ? `${path}.${k}` : k;
      return isSecretKey(k) ? [p] : findSecrets(v, p, depth + 1);
    });
  }
  return [];
}
