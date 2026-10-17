import { describe, expect, it } from "vitest";
import { createAnthropicLlmClient, LlmProviderError, loadLlmConfig } from "../../src/agents/llm/llmClient.js";
import { loadBusinessInfo, UNCONFIGURED_BUSINESS_INFO } from "../../src/config/businessInfo.js";
import { ValidationError } from "../../src/lib/errors.js";

const KEY = "sk-ant-test-0000000000000000";

describe("loadLlmConfig", () => {
  it("applies defaults", () => {
    expect(loadLlmConfig({ ANTHROPIC_API_KEY: KEY })).toEqual({
      apiKey: KEY,
      model: "claude-opus-5-5",
      maxTokens: 8000,
      timeoutMs: 60000,
      effort: "medium",
      refusalFallback: true,
    });
  });

  it("requires a key and never echoes values in errors", () => {
    expect(() => loadLlmConfig({})).toThrow(ValidationError);
    try {
      loadLlmConfig({ ANTHROPIC_API_KEY: KEY, SALES_AGENT_MAX_TOKENS: "abc" });
    } catch (e) {
      expect(JSON.stringify((e as ValidationError).issues)).not.toContain(KEY);
    }
  });
});

describe("createAnthropicLlmClient (official SDK, fake transport)", () => {
  const config = loadLlmConfig({ ANTHROPIC_API_KEY: KEY });

  it("sends the configured model, effort, tools and refusal fallback", async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = createAnthropicLlmClient(config, { fetch: fakeFetch });
    const msg = await client.createMessage({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
    });
    expect(msg.content[0]).toMatchObject({ type: "text", text: "hi" });
    const c = captured!;
    expect(c.url).toContain("/v1/messages");
    expect(c.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      system: "sys",
      output_config: { effort: "medium" },
      fallbacks: "default",
    });
    expect(c.body).not.toHaveProperty("thinking");
    expect(c.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("maps provider failures to LlmProviderError without exposing the key", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = createAnthropicLlmClient(config, { fetch: fakeFetch, maxRetries: 0 });
    const err = await client.createMessage({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.retryable).toBe(false);
    expect(String(err.message)).not.toContain(KEY);
  });
});

describe("business info", () => {
  it("defaults every store fact to null", () => {
    expect(loadBusinessInfo({})).toEqual(UNCONFIGURED_BUSINESS_INFO);
    expect(UNCONFIGURED_BUSINESS_INFO).toMatchObject({ address: null, openingHours: null, phone: null, isDemo: false });
  });
});
