import type { Metadata } from "next";
import { resolveWebsiteChatConfig } from "@zarghoon/core/website";
import ChatWidget from "@/components/chat/ChatWidget";

/**
 * The chat as shown inside an existing website: loaded in an iframe by
 * public/zarghoon-ai.js. Who may frame this page is restricted by the CSP
 * frame-ancestors header (ZARGHOON_EMBED_ALLOWED_ORIGINS, see next.config.ts).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Zarghoon AI", robots: { index: false, follow: false } };

export default function EmbeddedChatPage() {
  const chat = resolveWebsiteChatConfig(process.env);
  if (chat.mode === "off") {
    return <p className="p-6 text-sm text-charcoal/70">Zarghoon AI chat is not available right now.</p>;
  }
  return <ChatWidget mode={chat.mode} model={chat.model} embedded />;
}
