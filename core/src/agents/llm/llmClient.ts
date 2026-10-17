import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import { zodIssues } from "../../lib/validation.js";

/**
 * Provider abstraction for the language model.
 *
 * Agents depend only on `LlmClient`, so tests inject a scripted fake and
 * never need credentials. The real implementation wraps the official
 * Anthropic SDK. The API key is read from the environment and is never
 * logged, returned or stored.
 */

export type LlmMessageParam = Anthropic.Beta.BetaMessageParam;
export type LlmTool = Anthropic.Beta.BetaTool;
export type LlmMessage = Anthropic.Beta.BetaMessage;
export type LlmContentBlock = Anthropic.Beta.BetaContentBlock;
export type LlmToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type LlmToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;

export interface LlmRequest {
  system: string;
  messages: LlmMessageParam[];
  tools: LlmTool[];
}

export interface LlmClient {
  /** Model identifier, for audit records. */
  readonly model: string;
  createMessage(request: LlmRequest, options?: { signal?: AbortSignal }): Promise<LlmMessage>;
}

/** Thrown when the model provider fails (network, auth, rate limit, refusal…). */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}

const llmConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required for live model calls"),
  SALES_AGENT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  SALES_AGENT_MAX_TOKENS: z.coerce.number().int().min(1024).max(64_000).default(8000),
  SALES_AGENT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),
  SALES_AGENT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  /** Server-side refusal fallback (see docs/sales-agent.md). Set "false" to disable. */
  SALES_AGENT_REFUSAL_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export interface AnthropicLlmConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  refusalFallback: boolean;
}

/** Reads model settings from the environment. Error messages never include values. */
export function loadLlmConfig(source: NodeJS.ProcessEnv = process.env): AnthropicLlmConfig {
  const result = llmConfigSchema.safeParse(source);
  if (!result.success) throw new ValidationError("Invalid model configuration", zodIssues(result.error));
  const c = result.data;
  return {
    apiKey: c.ANTHROPIC_API_KEY,
    model: c.SALES_AGENT_MODEL,
    maxTokens: c.SALES_AGENT_MAX_TOKENS,
    timeoutMs: c.SALES_AGENT_TIMEOUT_MS,
    effort: c.SALES_AGENT_EFFORT,
    refusalFallback: c.SALES_AGENT_REFUSAL_FALLBACK,
  };
}

export function createAnthropicLlmClient(
  config: AnthropicLlmConfig,
  /** Test seam: inject a fake fetch to inspect requests without network or credentials. */
  options: { fetch?: typeof fetch; maxRetries?: number } = {},
): LlmClient {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: options.maxRetries ?? 2,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    model: config.model,
    async createMessage(request, options) {
      try {
        return await client.beta.messages.create(
          {
            model: config.model,
            max_tokens: config.maxTokens,
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            // Claude Opus 5.5 always thinks adaptively; effort is the depth control.
            output_config: { effort: config.effort },
            // If a request is declined by a safety classifier, the API retries it
            // on a fallback model instead of returning an empty refusal.
            ...(config.refusalFallback
              ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
              : {}),
          },
          { signal: options?.signal },
        );
      } catch (error) {
        // Most specific first. Messages come from the SDK and contain no key.
        if (error instanceof Anthropic.AuthenticationError) {
          throw new LlmProviderError("Model provider rejected the credentials", false, { cause: error });
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new LlmProviderError("Model provider rate limit reached", true, { cause: error });
        }
        if (error instanceof Anthropic.BadRequestError) {
          throw new LlmProviderError(`Model request was invalid: ${error.message}`, false, { cause: error });
        }
        if (error instanceof Anthropic.APIError) {
          throw new LlmProviderError(`Model provider error (${error.status ?? "network"})`, true, { cause: error });
        }
        throw error;
      }
    },
  };
}
