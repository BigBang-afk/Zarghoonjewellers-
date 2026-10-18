import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, WebsiteChatError, type ChatVisitor } from "@zarghoon/core/website";
import { auth } from "@/lib/auth";

/** Request hardening shared by the /api/chat routes. */

export const MAX_BODY_BYTES = 4096;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(error: unknown) {
  if (error instanceof WebsiteChatError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
      error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {},
    );
  }
  // Never leak internals to the browser.
  return jsonResponse({ error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } }, 500);
}

/**
 * CSRF protection: POSTs must carry our custom header (which cross-site pages
 * cannot send without a CORS preflight we never approve) and, when the
 * browser sends an Origin, it must match this site.
 */
export function assertSameOrigin(req: NextRequest) {
  if (req.headers.get("x-zarghoon-chat") !== "1") {
    throw new WebsiteChatError(403, "invalid_input", "Request not allowed.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) throw new WebsiteChatError(403, "invalid_input", "Request not allowed.");
  }
}

/** Reads a JSON body with a hard size limit. */
export async function readJsonBody(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new WebsiteChatError(413, "invalid_input", "Message is too long.");
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new WebsiteChatError(413, "invalid_input", "Message is too long.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new WebsiteChatError(400, "invalid_input", "Invalid request.");
  }
}

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

/** Identity comes from the HttpOnly cookie and the website's own auth — never from the request body. */
export async function visitorFrom(req: NextRequest): Promise<ChatVisitor> {
  // If the website's auth is misconfigured or unavailable, chat still works — as an anonymous visitor.
  const session = await auth().catch(() => null);
  const user = session?.user;
  return {
    sessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null,
    // Only signed-in customers are linked to a CRM identity; staff/admin accounts are not customers.
    account: user?.role === "CUSTOMER" && user.id ? { userId: user.id, fullName: user.name ?? null } : null,
    ip: clientIp(req),
  };
}

export function withSessionCookie(res: NextResponse, token: string | null, secure: boolean) {
  if (token) {
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/api/chat",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  }
  return res;
}
