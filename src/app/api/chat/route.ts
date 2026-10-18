import type { NextRequest } from "next/server";
import { getChatRuntime } from "@/lib/zarghoon/chatRuntime";
import { assertSameOrigin, errorResponse, jsonResponse, readJsonBody, visitorFrom, withSessionCookie } from "@/lib/zarghoon/http";

/**
 * Website AI chat.
 *   GET  /api/chat → chat availability + this visitor's current conversation
 *   POST /api/chat → { message } → one Sales Agent turn
 * The visitor is identified by an HttpOnly session cookie (and the website
 * login, if signed in) — never by ids in the request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Agent turns are bounded at 45 s; leave headroom for the response.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const rt = await getChatRuntime();
    const out = await rt.chat.getState(await visitorFrom(req));
    return jsonResponse(out.body);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJsonBody(req);
    const rt = await getChatRuntime();
    const out = await rt.chat.sendMessage(await visitorFrom(req), body);
    return withSessionCookie(jsonResponse(out.body), out.sessionToken, rt.config.secureCookies);
  } catch (error) {
    return errorResponse(error);
  }
}
