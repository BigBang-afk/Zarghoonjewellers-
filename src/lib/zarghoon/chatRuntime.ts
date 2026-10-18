import "server-only";
import { createLogger } from "@zarghoon/core";
import { createWebsiteChatRuntime, type WebsiteChatRuntime } from "@zarghoon/core/website";

/**
 * One chat runtime per server process (cached on globalThis so dev hot
 * reloads don't spawn new in-memory databases). Secrets (ANTHROPIC_API_KEY,
 * ZARGHOON_CORE_DATABASE_URL) are read here, on the server, and never leave it.
 */

const globalForChat = globalThis as unknown as { zarghoonChatRuntime?: Promise<WebsiteChatRuntime> };

// Structured logs carry request ids and outcomes only — never message text.
const logger = createLogger({ service: "website-chat" }, (line) => process.stderr.write(`${line}\n`));

export function getChatRuntime(): Promise<WebsiteChatRuntime> {
  globalForChat.zarghoonChatRuntime ??= createWebsiteChatRuntime(process.env, { logger }).catch((error) => {
    globalForChat.zarghoonChatRuntime = undefined;
    throw error;
  });
  return globalForChat.zarghoonChatRuntime;
}

/** Demo only: discards the in-memory database and starts again from the DEMO fixtures. */
export async function resetDemoRuntime(): Promise<void> {
  const current = globalForChat.zarghoonChatRuntime;
  globalForChat.zarghoonChatRuntime = undefined;
  if (current) await (await current).close().catch(() => undefined);
}
