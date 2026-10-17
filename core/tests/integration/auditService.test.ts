import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("audit log", () => {
  it("redacts secrets before storage and records actor and request IDs", async () => {
    const id = await core.audit.recordAction(
      { ...AI_CTX, toolName: "searchProducts" },
      { actionType: "tool_call", input: { query: "bridal", apiKey: "sk-ant-api03-secretsecret", nested: { password: "p" } } },
    );
    const [action] = await core.audit.listActions({ actionType: "tool_call" });
    expect(action).toMatchObject({
      id,
      actorType: "ai",
      agentName: "sales_agent",
      toolName: "searchProducts",
      requestId: "req-test",
      input: { query: "bridal", apiKey: "[REDACTED]", nested: { password: "[REDACTED]" } },
    });
    expect(JSON.stringify(action)).not.toContain("secretsecret");
  });
});
