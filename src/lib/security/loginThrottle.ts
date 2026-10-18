/**
 * Slows down password guessing on the website login: after 5 failed attempts
 * for a username (or 20 from one address) within 15 minutes, further attempts
 * are refused until the window passes. Kept in memory per server instance —
 * a shared store is needed when the site runs on several instances.
 */

const WINDOW_MS = 15 * 60_000;
const MAX_PER_USERNAME = 5;
const MAX_PER_ADDRESS = 20;
const MAX_KEYS = 10_000;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

const keys = (username: string, address: string | null) => ({
  user: `u:${username.toLowerCase()}`,
  addr: address ? `a:${address}` : null,
});

export function isLoginThrottled(username: string, address: string | null, now = Date.now()): boolean {
  const k = keys(username, address);
  if (recent(k.user, now).length >= MAX_PER_USERNAME) return true;
  return k.addr !== null && recent(k.addr, now).length >= MAX_PER_ADDRESS;
}

export function recordLoginFailure(username: string, address: string | null, now = Date.now()): void {
  if (failures.size > MAX_KEYS) failures.clear();
  const k = keys(username, address);
  for (const key of [k.user, k.addr]) {
    if (key) failures.set(key, [...recent(key, now), now]);
  }
}

export function clearLoginFailures(username: string): void {
  failures.delete(keys(username, null).user);
}

/** The client address as reported by the hosting proxy (first hop), if any. */
export function clientAddress(request: Request | undefined): string | null {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request?.headers.get("x-real-ip")?.trim() || null;
}
