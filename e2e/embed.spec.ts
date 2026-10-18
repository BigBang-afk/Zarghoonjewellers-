import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { isServicePathAllowed, embedFrameAncestors } from "../src/lib/zarghoon/embedConfig";

/**
 * The one-line embed on an existing website (served by a static test fixture
 * on another port). Same-site case: store on localhost:4000, chat service on
 * localhost:3000 (dev server, demo mode).
 */

const STORE = "http://localhost:4000/";

async function openEmbeddedChat(page: Page): Promise<FrameLocator> {
  await page.getByTestId("zarghoon-ai-launcher").click();
  await expect(page.getByTestId("zarghoon-ai-frame")).toBeVisible();
  const chat = page.frameLocator('[data-testid="zarghoon-ai-frame"] iframe');
  await expect(chat.getByTestId("chat-panel")).toBeVisible();
  return chat;
}

async function sendInFrame(chat: FrameLocator, text: string) {
  const before = await chat.getByTestId("msg-customer").count();
  // Typing before React hydrates inside the iframe would be discarded: retry until the input is live.
  await expect(async () => {
    await chat.getByTestId("chat-input").fill(text);
    await expect(chat.getByTestId("chat-send")).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await chat.getByTestId("chat-send").click();
  await expect(chat.getByTestId("msg-customer")).toHaveCount(before + 1);
  await expect(chat.getByTestId("typing-indicator")).toHaveCount(0, { timeout: 45_000 });
}

test.beforeEach(async ({ request }) => {
  const res = await request.post("http://localhost:3000/api/chat/reset", {
    headers: { "x-zarghoon-chat": "1", "content-type": "application/json" },
    data: { scope: "demo" },
  });
  expect(res.ok()).toBe(true);
});

test("the existing site is untouched: its content, styles and buttons keep working", async ({ page }) => {
  await page.goto(STORE);
  await expect(page.locator("#product-name")).toHaveText("Store Product");
  await expect(page.locator("#product-price")).toHaveText("Rs. 123,456");
  const addToCart = page.locator("#add-to-cart");
  await expect(addToCart).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await addToCart.click();
  await expect(addToCart).toHaveText("Added to cart");
  // The widget is isolated in a Shadow DOM: the store's global button CSS doesn't reach it.
  await expect(page.getByTestId("zarghoon-ai-launcher")).toHaveCSS("background-color", "rgb(28, 23, 18)");
  // The site's own page structure is unchanged apart from the widget's single host element.
  expect(await page.evaluate(() => document.body.children.length)).toBe(4); // header, main, script, widget host
});

test("opens, chats with verified products, closes and reopens with history kept", async ({ page }) => {
  await page.goto(STORE);
  const chat = await openEmbeddedChat(page);
  await expect(chat.getByTestId("chat-panel")).toContainText("Assalamualaikum! Welcome to Zarghoon Jewellers.");
  await chat.getByTestId("chat-suggestions").getByRole("button", { name: "Show bridal jewelry" }).click();
  await expect(chat.getByTestId("typing-indicator")).toHaveCount(0, { timeout: 45_000 });
  const kundan = chat.getByTestId("msg-assistant").last().getByRole("listitem").filter({ hasText: "DEMO-NK-001" });
  await expect(kundan).toContainText("PKR 485,000");
  await expect(kundan).toContainText("In stock");

  await chat.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByTestId("zarghoon-ai-frame")).toBeHidden();
  await expect(page.getByTestId("zarghoon-ai-launcher")).toBeVisible();

  await page.getByTestId("zarghoon-ai-launcher").click();
  await expect(chat.getByTestId("msg-customer")).toHaveText(["Show bridal jewelry"]);
  // Reload the store page: the conversation persists (session cookie of the chat service).
  await page.reload();
  const again = await openEmbeddedChat(page);
  await expect(again.getByTestId("msg-customer")).toHaveText(["Show bridal jewelry"]);
});

test("Roman Urdu, Urdu and human handoff inside the embed", async ({ page }) => {
  await page.goto(STORE);
  const chat = await openEmbeddedChat(page);
  await sendInFrame(chat, "22k kangan dikhao");
  await expect(chat.getByTestId("msg-assistant").last().getByRole("listitem")).toHaveCount(1);
  await sendInFrame(chat, "کیا آپ کے پاس جھمکے ہیں؟");
  await expect(chat.getByTestId("msg-assistant").last()).toContainText("DEMO Gold Jhumka Earrings");
  await sendInFrame(chat, "I want to speak to someone");
  await expect(chat.getByTestId("handoff-notice").last()).toHaveText("Our team will assist you with this request.");
  const assistantCount = await chat.getByTestId("msg-assistant").count();
  await sendInFrame(chat, "Hello?");
  await expect(chat.getByTestId("msg-assistant")).toHaveCount(assistantCount);
});

test("the host page can open the chat from its own button and cannot read the chat session", async ({ page, context }) => {
  await page.goto(STORE);
  await page.evaluate(() => (window as unknown as { ZarghoonAI: { open(): void } }).ZarghoonAI.open());
  const chat = page.frameLocator('[data-testid="zarghoon-ai-frame"] iframe');
  await sendInFrame(chat, "Show me rings");
  expect(await page.evaluate(() => document.cookie)).not.toContain("zj_chat_sid");
  const cookie = (await context.cookies("http://localhost:3000/api/chat")).find((c) => c.name === "zj_chat_sid");
  expect(cookie).toMatchObject({ httpOnly: true, path: "/api/chat" });
});

test("the embed page is framable only by allowed sites and not indexed", async ({ request }) => {
  const res = await request.get("http://localhost:3000/embed/chat");
  expect(res.ok()).toBe(true);
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'self'");
  expect(res.headers()["x-robots-tag"]).toBe("noindex");
});

test("embed policy rules", () => {
  expect(embedFrameAncestors({ NODE_ENV: "production" })).toBe("'self'");
  expect(
    embedFrameAncestors({
      NODE_ENV: "production",
      ZARGHOON_EMBED_ALLOWED_ORIGINS: "https://zarghoonjewllers.com https://www.zarghoonjewllers.com javascript:alert(1) http://evil.example *",
    }),
  ).toBe("'self' https://zarghoonjewllers.com https://www.zarghoonjewllers.com");
  for (const ok of ["/embed/chat", "/api/chat", "/api/chat/reset", "/zarghoon-ai.js", "/_next/static/x.js"]) expect(isServicePathAllowed(ok)).toBe(true);
  for (const blocked of ["/", "/login", "/admin", "/api/register", "/api/admin/products", "/dashboard", "/embedded"]) {
    expect(isServicePathAllowed(blocked), blocked).toBe(false);
  }
});
