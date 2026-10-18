import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page. Two jobs:
 *  1. Send visitors without a session cookie to /login (a convenience only —
 *     every page and action verifies the session in the database).
 *  2. Security headers: no framing, no indexing, no caching of private pages,
 *     a restrictive Content Security Policy.
 */

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-zj_staff" : "zj_staff";

function securityHeaders(res: NextResponse) {
  const dev = process.env.NODE_ENV !== "production";
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "font-src 'self'",
      `connect-src 'self'${dev ? " ws:" : ""}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "no-store");
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  if (!isLogin && !request.cookies.has(COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return securityHeaders(NextResponse.redirect(url));
  }
  return securityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
