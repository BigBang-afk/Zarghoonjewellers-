import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import { zodIssues } from "../../lib/validation.js";

/**
 * Website chat runtime configuration, resolved from environment variables.
 *
 * Modes:
 *  - "demo": in-memory PostgreSQL seeded with DEMO- fixtures. Session-only:
 *    everything is lost when the server restarts. Never touches a real database.
 *  - "staging": a persistent staging database (ZARGHOON_CORE_DATABASE_URL) with
 *    test data; Claude if ANTHROPIC_API_KEY is set, otherwise the labelled
 *    offline demo model. Shown as "Staging" in the chat.
 *  - "live": the real Zarghoon core database (ZARGHOON_CORE_DATABASE_URL) and Claude.
 *  - "off":  the chat is disabled and the launcher is hidden.
 *
 * Defaults are safe: "demo" in development, "off" in production. Demo mode in
 * a production build must be requested explicitly.
 */

const boolString = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  ZARGHOON_CHAT_MODE: z.enum(["demo", "staging", "live", "off"]).optional(),
  ZARGHOON_CORE_DATABASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ZARGHOON_CHAT_DEBUG: boolString,
  ZARGHOON_CHAT_SESSION_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(8),
  ZARGHOON_CHAT_SESSION_PER_DAY: z.coerce.number().int().min(1).max(5000).default(80),
  ZARGHOON_CHAT_IP_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
  ZARGHOON_CHAT_GLOBAL_PER_DAY: z.coerce.number().int().min(1).max(1_000_000).default(2000),
});

export type ChatMode = "demo" | "staging" | "live" | "off";
export type ChatModelKind = "claude" | "offline_demo" | "none";

export interface WebsiteChatLimits {
  sessionPerMinute: number;
  sessionPerDay: number;
  ipPerMinute: number;
  /** Cost protection: total AI turns per day across all visitors (per server instance). */
  globalPerDay: number;
}

export interface WebsiteChatConfig {
  mode: ChatMode;
  model: ChatModelKind;
  /** Why the chat cannot answer, when model is "none" or mode is "off". */
  unavailableReason: string | null;
  databaseUrl: string | null;
  /** Internal debugging (lead score etc.). Never enabled in production builds. */
  debug: boolean;
  limits: WebsiteChatLimits;
  /** Secure cookies everywhere except local development over http. */
  secureCookies: boolean;
}

export function resolveWebsiteChatConfig(env: NodeJS.ProcessEnv): WebsiteChatConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new ValidationError("Invalid website chat configuration", zodIssues(result.error));
  const e = result.data;
  const production = e.NODE_ENV === "production";
  const mode: ChatMode = e.ZARGHOON_CHAT_MODE ?? (production ? "off" : "demo");
  const hasKey = !!e.ANTHROPIC_API_KEY && e.ANTHROPIC_API_KEY.trim().length > 0;

  let model: ChatModelKind = "none";
  let unavailableReason: string | null = null;
  if (mode === "off") {
    unavailableReason = "Website chat is turned off (ZARGHOON_CHAT_MODE=off)";
  } else if (mode === "live") {
    if (!e.ZARGHOON_CORE_DATABASE_URL) unavailableReason = "ZARGHOON_CORE_DATABASE_URL is not set";
    else if (!hasKey) unavailableReason = "ANTHROPIC_API_KEY is not set";
    else model = "claude";
  } else if (mode === "staging") {
    if (!e.ZARGHOON_CORE_DATABASE_URL) unavailableReason = "ZARGHOON_CORE_DATABASE_URL is not set";
    else model = hasKey ? "claude" : "offline_demo";
  } else {
    // Demo: use Claude when a key is present; otherwise a clearly labelled offline stand-in.
    model = hasKey ? "claude" : "offline_demo";
  }

  return {
    mode,
    model,
    unavailableReason,
    databaseUrl: mode === "live" || mode === "staging" ? (e.ZARGHOON_CORE_DATABASE_URL ?? null) : null,
    debug: !production && e.ZARGHOON_CHAT_DEBUG,
    limits: {
      sessionPerMinute: e.ZARGHOON_CHAT_SESSION_PER_MINUTE,
      sessionPerDay: e.ZARGHOON_CHAT_SESSION_PER_DAY,
      ipPerMinute: e.ZARGHOON_CHAT_IP_PER_MINUTE,
      globalPerDay: e.ZARGHOON_CHAT_GLOBAL_PER_DAY,
    },
    secureCookies: production,
  };
}
