import { expect, test } from "@playwright/test";

/**
 * Production-like cross-site embedding (opt-in: E2E_CROSS_SITE=1 after `npm run build`).
 * Store: http://127.0.0.1:4000 — Zarghoon AI service: http://localhost:3001
 * (production build, service-only mode, embed allowlist, partitioned cookies).
 */
test.skip(process.env.E2E_CROSS_SITE !== "1", "Set E2E_CROSS_SITE=1 (after npm run build) to run");

const SERVICE = "http://localhost:3001";

test("cross-site embed keeps the conversation with a partitioned cookie", async ({ page }) => {
  await page.goto("http://127.0.0.1:4000/cross-site.html");
  await page.getByTestId("zarghoon-ai-launcher").click();
  const chat = page.frameLocator('[data-testid="zarghoon-ai-frame"] iframe');
  await expect(chat.getByTestId("chat-panel")).toBeVisible();
  await chat.getByTestId("chat-input").fill("Show me rings");
  await chat.getByTestId("chat-send").click();
  await expect(chat.getByTestId("msg-assistant").last()).toContainText("DEMO Solitaire Engagement Ring", { timeout: 45_000 });
  await page.reload();
  await page.getByTestId("zarghoon-ai-launcher").click();
  await expect(chat.getByTestId("msg-customer")).toHaveText(["Show me rings"]);
});

test("service-only mode exposes the chat and nothing else", async ({ request }) => {
  for (const path of ["/", "/login", "/register", "/admin", "/dashboard"]) {
    expect((await request.get(SERVICE + path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  expect((await request.get(SERVICE + "/zarghoon-ai.js")).status()).toBe(200);
  const embed = await request.get(SERVICE + "/embed/chat");
  expect(embed.status()).toBe(200);
  expect(embed.headers()["content-security-policy"]).toBe("frame-ancestors 'self' http://127.0.0.1:4000");
});

test("an unlisted site cannot frame the chat", async ({ page }) => {
  // localhost:4000 is not in ZARGHOON_EMBED_ALLOWED_ORIGINS for the production service.
  const blocked: string[] = [];
  page.on("console", (m) => blocked.push(m.text()));
  await page.goto("http://localhost:4000/cross-site.html");
  await page.getByTestId("zarghoon-ai-launcher").click();
  await expect.poll(() => blocked.some((t) => /frame-ancestors|Refused to frame/i.test(t))).toBe(true);
});
