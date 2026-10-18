import type { NextRequest } from "next/server";
import { WebsiteChatError } from "@zarghoon/core/website";
import { getChatRuntime, resetDemoRuntime } from "@/lib/zarghoon/chatRuntime";
import { assertSameOrigin, errorResponse, jsonResponse, readJsonBody, visitorFrom } from "@/lib/zarghoon/http";

/**
 * POST /api/chat/reset
 *   { scope: "conversation" } → close this visitor's conversation (not allowed during a human handoff)
 *   { scope: "demo" }         → development demo only: wipe the in-memory demo database
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = (await readJsonBody(req)) as { scope?: unknown };
    const rt = await getChatRuntime();
    if (body.scope === "demo") {
      if (rt.config.mode !== "demo" || process.env.NODE_ENV === "production") {
        throw new WebsiteChatError(403, "invalid_input", "Demo reset is only available in development demo mode.");
      }
      await resetDemoRuntime();
      return jsonResponse({ reset: true, scope: "demo" });
    }
    const out = await rt.chat.resetConversation(await visitorFrom(req));
    return jsonResponse({ ...out.body, scope: "conversation" });
  } catch (error) {
    return errorResponse(error);
  }
}
