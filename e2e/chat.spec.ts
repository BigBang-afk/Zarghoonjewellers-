import { expect, test } from "@playwright/test";
import { openChat, resetDemo, sendChat } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await resetDemo(page);
});

test("1. opening the chat shows the header, welcome, suggestions and demo labels", async ({ page }) => {
  const panel = await openChat(page);
  await expect(panel.getByRole("heading", { name: /Zarghoon AI/ })).toBeVisible();
  await expect(panel).toContainText("Your Personal Jewelry Assistant");
  await expect(panel).toContainText("Assalamualaikum! Welcome to Zarghoon Jewellers. How may I help you today?");
  const suggestions = page.getByTestId("chat-suggestions");
  for (const s of ["Show bridal jewelry", "Show 22K bangles", "Help me choose a gift", "I want to speak to someone"]) {
    await expect(suggestions.getByRole("button", { name: s })).toBeVisible();
  }
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  await expect(page.getByTestId("demo-banner")).toContainText("DEMO products");
});

test("2–5. sending a message returns verified product cards; unknown price shows Needs confirmation", async ({ page }) => {
  await openChat(page);
  await page.getByTestId("chat-suggestions").getByRole("button", { name: "Show bridal jewelry" }).click();
  await expect(page.getByTestId("typing-indicator")).toHaveCount(0, { timeout: 45_000 });
  const reply = page.getByTestId("msg-assistant").last();
  await expect(reply).toContainText("DEMO Bridal Kundan Necklace Set");
  const kundan = reply.getByRole("listitem").filter({ hasText: "DEMO-NK-001" });
  await expect(kundan).toContainText("PKR 485,000");
  await expect(kundan).toContainText("22K");
  await expect(kundan).toContainText("62.5 g");
  await expect(kundan).toContainText("In stock");
  const polki = reply.getByRole("listitem").filter({ hasText: "DEMO-NK-002" });
  await expect(polki).toContainText("Needs confirmation");
  await expect(polki).toContainText("Ask for details");
  await expect(reply.getByRole("listitem").filter({ hasText: "DEMO-NK-003" })).toContainText("Out of stock");
});

test("6. no matching product is answered honestly with no cards", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "Show me 18k bangles");
  const reply = page.getByTestId("msg-assistant").last();
  await expect(reply).toContainText("couldn't find");
  await expect(reply.getByRole("listitem")).toHaveCount(0);
});

test("7. lead score updates from the scoring engine (internal debug only)", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "Show 22K bangles");
  await expect(page.getByTestId("chat-debug")).toContainText("lead score: 0");
  await page.getByRole("button", { name: "Share contact details" }).click();
  await page.getByPlaceholder("Phone / WhatsApp").fill("0300 1112233");
  await page.getByRole("button", { name: "Save my details" }).click();
  await expect(page.getByTestId("chat-panel")).toContainText("we've saved your details");
  await sendChat(page, "Any rings?");
  await expect(page.getByTestId("chat-debug")).toContainText("lead score: 10"); // provided_contact
  // Never part of the customer-facing conversation.
  await expect(page.getByTestId("chat-messages")).not.toContainText("lead score");
});

test("8 + close/reopen. conversation persists across close, reopen and reload", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "Show me rings");
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByTestId("chat-panel")).toHaveCount(0);
  await openChat(page);
  await expect(page.getByTestId("msg-customer")).toHaveText(["Show me rings"]);
  await page.reload();
  await openChat(page);
  await expect(page.getByTestId("msg-customer")).toHaveText(["Show me rings"]);
  await expect(page.getByTestId("msg-assistant").last()).toContainText("DEMO Solitaire Engagement Ring");
});

test("9. Roman Urdu message", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "22k kangan dikhao");
  const cards = page.getByTestId("msg-assistant").last().getByRole("listitem");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("DEMO-BG-001");
});

test("10. Urdu message renders right-to-left in Nastaliq", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "کیا آپ کے پاس جھمکے ہیں؟");
  const bubble = page.getByTestId("msg-customer").last().locator("div");
  await expect(bubble).toHaveAttribute("dir", "auto");
  await expect(bubble).toHaveClass(/font-urdu/);
  await expect(page.getByTestId("msg-assistant").last().getByRole("listitem").first()).toContainText("DEMO-ER-001");
});

test("11–12. human handoff shows the notice and the AI stops replying", async ({ page }) => {
  await openChat(page);
  await page.getByTestId("chat-suggestions").getByRole("button", { name: "I want to speak to someone" }).click();
  await expect(page.getByTestId("handoff-notice").last()).toHaveText("Our team will assist you with this request.");
  await expect(page.getByTestId("handoff-notice")).toHaveCount(1);
  await expect(page.getByTestId("msg-assistant").last()).toContainText("team will assist you");
  await expect(page.getByTestId("chat-panel")).toContainText("A team member is assisting you");
  const assistantCount = await page.getByTestId("msg-assistant").count();

  await sendChat(page, "Hello, are you still there?");
  await expect(page.getByTestId("msg-assistant")).toHaveCount(assistantCount); // no new AI reply
  await expect(page.getByTestId("handoff-notice").last()).toBeVisible();

  // Starting over is not a way around the handoff.
  await page.getByRole("button", { name: "Start a new conversation" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("A member of our team is looking after this conversation");
  // Demo reset clears everything for the next test run.
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByTestId("chat-panel")).toContainText("Demo data has been reset.");
  await expect(page.getByTestId("msg-customer")).toHaveCount(0);
});

test("discount requests are handed off without promising anything", async ({ page }) => {
  await openChat(page);
  await sendChat(page, "Can I get a discount on the bridal set?");
  await expect(page.getByTestId("handoff-notice").last()).toBeVisible();
  await expect(page.getByTestId("chat-messages")).not.toContainText("%");
});

test("13. API failure shows a friendly error with retry", async ({ page }) => {
  await openChat(page);
  await page.route("**/api/chat", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } }) })
      : route.continue(),
  );
  await page.getByTestId("chat-input").fill("Show me rings");
  await page.getByTestId("chat-send").click();
  const error = page.getByTestId("chat-error");
  await expect(error).toContainText("Something went wrong on our side");
  await page.unroute("**/api/chat");
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("msg-assistant").last()).toContainText("DEMO Solitaire Engagement Ring");
});

test("15. invalid input: empty messages can't be sent and oversized ones are refused by the API", async ({ page }) => {
  await openChat(page);
  await expect(page.getByTestId("chat-send")).toBeDisabled();
  await page.getByTestId("chat-input").fill("   ");
  await expect(page.getByTestId("chat-send")).toBeDisabled();
  await expect(page.getByTestId("chat-input")).toHaveAttribute("maxlength", "1000");

  const headers = { "x-zarghoon-chat": "1", "content-type": "application/json" };
  const tooLong = await page.request.post("/api/chat", { headers, data: { message: "x".repeat(1001) } });
  expect(tooLong.status()).toBe(400);
  const noHeader = await page.request.post("/api/chat", { headers: { "content-type": "application/json" }, data: { message: "hi" } });
  expect(noHeader.status()).toBe(403);
  const forgedIds = await page.request.post("/api/chat", { headers, data: { message: "hi", customerId: "00000000-0000-4000-8000-000000000000" } });
  expect(forgedIds.status()).toBe(400);
});

test("16. visitors cannot see each other's conversations", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  await pageA.goto("/");
  await openChat(pageA);
  await sendChat(pageA, "My private anniversary gift plans for bangles");
  await pageB.goto("/");
  await openChat(pageB);
  await expect(pageB.getByTestId("msg-customer")).toHaveCount(0);
  const state = await (await pageB.request.get("/api/chat")).text();
  expect(state).not.toContain("anniversary");
  // A forged cookie is ignored, not trusted.
  await b.addCookies([{ name: "zj_chat_sid", value: "A".repeat(43), url: "http://localhost:3000/api/chat" }]);
  expect(await (await pageB.request.get("/api/chat")).text()).not.toContain("anniversary");
  await a.close();
  await b.close();
});

test("the session cookie is HttpOnly and not readable by page scripts", async ({ page, context }) => {
  await openChat(page);
  await sendChat(page, "Show me rings");
  const cookie = (await context.cookies("http://localhost:3000/api/chat")).find((c) => c.name === "zj_chat_sid");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api/chat" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("zj_chat_sid");
});
