import { createAnthropicLlmClient, loadLlmConfig, type LlmClient } from "../../agents/llm/llmClient.js";
import { createSalesAgent } from "../../agents/sales/salesAgent.js";
import { loadBusinessInfo, type BusinessInfo } from "../../config/businessInfo.js";
import { createPgDb, type Db } from "../../database/db.js";
import { createZarghoonCore, type ZarghoonCore } from "../../index.js";
import type { Logger } from "../../lib/logger.js";
import { resolveWebsiteChatConfig, type WebsiteChatConfig } from "./config.js";
import { createWebsiteChat, type WebsiteChat } from "./websiteChat.js";

/**
 * Builds everything the website chat needs from environment variables.
 *
 * demo → in-memory PostgreSQL with DEMO fixtures (dynamically imported so
 *        production never loads it) + Claude if ANTHROPIC_API_KEY is set,
 *        otherwise the labelled offline demo model.
 * live → the real core database + Claude. No key → chat unavailable (503).
 * off  → nothing is created.
 */

export interface WebsiteChatRuntime {
  config: WebsiteChatConfig;
  chat: WebsiteChat;
  core: ZarghoonCore | null;
  close(): Promise<void>;
}

/** Website turns get a tighter budget than the internal playground. */
const WEB_AGENT_CONFIG = { maxModelCalls: 6, turnTimeoutMs: 45_000, maxReplyCorrections: 2, historyLimit: 20 };

export async function createWebsiteChatRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: { logger?: Logger; llm?: LlmClient } = {},
): Promise<WebsiteChatRuntime> {
  const config = resolveWebsiteChatConfig(env);
  if (config.mode === "off") {
    return { config, chat: createWebsiteChat({ core: null as never, agent: null, config }), core: null, close: async () => {} };
  }

  let db: Db;
  let close: () => Promise<void>;
  let businessInfo: BusinessInfo;
  if (config.mode === "demo") {
    const { createInMemoryDb } = await import("../../database/pgliteDb.js");
    const { DEMO_BUSINESS_INFO, seedDemoData } = await import("../../demo/demoData.js");
    const memory = await createInMemoryDb();
    await seedDemoData(memory);
    db = memory;
    close = () => memory.close();
    businessInfo = DEMO_BUSINESS_INFO;
  } else {
    if (!config.databaseUrl) {
      // Live/staging without a database: nothing to connect to; the chat reports itself unavailable.
      return { config, chat: createWebsiteChat({ core: null as never, agent: null, config: { ...config, mode: "off" } }), core: null, close: async () => {} };
    }
    const pg = createPgDb(config.databaseUrl);
    db = pg;
    close = () => pg.end();
    businessInfo = loadBusinessInfo(env);
  }

  const core = createZarghoonCore({ db });
  let llm: LlmClient | null = options.llm ?? null;
  if (!llm && config.model === "claude") llm = createAnthropicLlmClient(loadLlmConfig(env));
  if (!llm && config.model === "offline_demo") {
    const { createOfflineDemoModel } = await import("../../demo/offlineDemoModel.js");
    llm = createOfflineDemoModel({ annotate: false }); // the website shows its own "not AI" banner
  }
  const agent = llm ? createSalesAgent({ core, llm, businessInfo, logger: options.logger, config: WEB_AGENT_CONFIG }) : null;
  const chat = createWebsiteChat({ core, agent, config, logger: options.logger });
  return { config, chat, core, close };
}
