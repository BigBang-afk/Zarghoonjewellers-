import type { LlmClient, LlmContentBlock, LlmMessage, LlmRequest } from "./llmClient.js";

/**
 * A credential-free LlmClient driven by a script. Used by tests and by the
 * playground's offline mode. Each step receives the full request (so it can
 * read earlier tool results) and returns the content of the next assistant turn.
 */

export type ScriptStep = (request: LlmRequest, callIndex: number) => LlmContentBlock[] | Promise<LlmContentBlock[]>;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(++idCounter).toString(36).padStart(6, "0")}`;

export function textBlock(text: string): LlmContentBlock {
  return { type: "text", text, citations: null } as LlmContentBlock;
}

export function toolUseBlock(name: string, input: unknown, id = nextId("toolu")): LlmContentBlock {
  return { type: "tool_use", id, name, input } as LlmContentBlock;
}

export function buildMessage(content: LlmContentBlock[], model = "scripted"): LlmMessage {
  const stopReason = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as LlmMessage;
}

export class ScriptedLlmClient implements LlmClient {
  readonly model = "scripted";
  readonly requests: LlmRequest[] = [];

  constructor(private readonly steps: ScriptStep[] | ((request: LlmRequest, callIndex: number) => ScriptStep | undefined)) {}

  async createMessage(request: LlmRequest, options?: { signal?: AbortSignal }): Promise<LlmMessage> {
    if (options?.signal?.aborted) throw new Error("aborted");
    // Snapshot: the agent keeps appending to the same array.
    this.requests.push({ ...request, messages: [...request.messages] });
    const index = this.requests.length - 1;
    const step = Array.isArray(this.steps) ? this.steps[index] : this.steps(request, index);
    if (!step) throw new Error(`Scripted LLM has no step for call #${index + 1}`);
    return buildMessage(await step(request, index), this.model);
  }
}

/** Returns the parsed JSON content of every tool_result the agent has sent so far. */
export function toolResults(request: LlmRequest): { toolUseId: string; isError: boolean; data: unknown }[] {
  const out: { toolUseId: string; isError: boolean; data: unknown }[] = [];
  for (const message of request.messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const raw = typeof block.content === "string" ? block.content : "";
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // keep raw text
      }
      out.push({ toolUseId: block.tool_use_id, isError: block.is_error === true, data });
    }
  }
  return out;
}

export function lastToolResult(request: LlmRequest) {
  const all = toolResults(request);
  return all[all.length - 1];
}
