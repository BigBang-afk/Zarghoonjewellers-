import type { NextRequest } from "next/server";
import { getChatRuntime } from "@/lib/zarghoon/chatRuntime";
import { assertSameOrigin, errorResponse, jsonResponse, readJsonBody, visitorFrom, withSessionCookie } from "@/lib/zarghoon/http";

/**
 * POST /api/chat/contact → { fullName?, phone?, email? }
 * Contact details the visitor typed into the form. Saved as self-reported;
 * never merged with another customer's record.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJsonBody(req);
    const rt = await getChatRuntime();
    const out = await rt.chat.submitContact(await visitorFrom(req), body);
    return withSessionCookie(jsonResponse(out.body), out.sessionToken, rt.config.secureCookies);
  } catch (error) {
    return errorResponse(error);
  }
}
