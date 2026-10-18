/**
 * Rejects cross-site state-changing requests to the admin API (defence in depth:
 * the session cookie is SameSite=Lax). Requests without an Origin header are
 * allowed — browsers send one on every cross-site POST/DELETE.
 */
export function isCrossSiteRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return !host || new URL(origin).host !== host;
  } catch {
    return true;
  }
}
