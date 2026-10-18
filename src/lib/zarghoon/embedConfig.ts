/**
 * Settings for embedding Zarghoon AI chat in an EXISTING website (any
 * platform) via one <script> tag. Pure functions only: used by next.config,
 * the middleware (edge runtime) and the API helpers.
 *
 *   ZARGHOON_EMBED_ALLOWED_ORIGINS  space-separated sites allowed to embed the chat,
 *                                   e.g. "https://zarghoonjewllers.com https://www.zarghoonjewllers.com"
 *   ZARGHOON_EMBED_CROSS_SITE       "true" when the chat service is on a different site
 *                                   than the store (not a subdomain of it)
 *   ZARGHOON_AI_SERVICE_ONLY        "true" to serve ONLY the chat (embed page, loader,
 *                                   chat API) — no other pages of this app
 */

const DEV_EMBED_ORIGINS = ["http://localhost:*", "http://127.0.0.1:*"];

/** Values for the CSP `frame-ancestors` directive of the embed page. */
export function embedFrameAncestors(env: Record<string, string | undefined>): string {
  const configured = (env.ZARGHOON_EMBED_ALLOWED_ORIGINS ?? "")
    .split(/\s+/)
    .filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+|:\*)?$/i.test(o));
  const dev = env.NODE_ENV !== "production" ? DEV_EMBED_ORIGINS : [];
  // Default in production: nobody else may frame the chat until origins are configured.
  return ["'self'", ...dev, ...configured].join(" ");
}

export function embedIsCrossSite(env: Record<string, string | undefined>): boolean {
  return env.ZARGHOON_EMBED_CROSS_SITE === "true";
}

const SERVICE_PATHS = [/^\/embed(\/|$)/, /^\/api\/chat(\/|$)/, /^\/zarghoon-ai\.js$/, /^\/_next\//, /^\/favicon\.ico$/];

/** In service-only mode, only the chat surfaces of this app are reachable. */
export function isServicePathAllowed(pathname: string): boolean {
  return SERVICE_PATHS.some((p) => p.test(pathname));
}
