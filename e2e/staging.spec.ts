import { expect, test } from "@playwright/test";
import { openChat, sendChat } from "./helpers";

/**
 * Opt-in (E2E_STAGING=1): the chat against a PERSISTENT staging database
 * (ZARGHOON_CHAT_MODE=staging) holding the STG- sample catalogue from
 * core/data/staging. Run on its own against a dev server started in staging
 * mode; it adds a test visitor to that staging database on every run.
 */
test.skip(process.env.E2E_STAGING !== "1", "needs a dev server in staging mode (E2E_STAGING=1)");

test("staging chat: search, price, stock, handoff, history kept after reload", async ({ page }) => {
  await page.goto("/");
  const panel = await openChat(page);
  await expect(panel).toContainText("Staging");
  await expect(panel).toContainText("test data only");

  await sendChat(page, "Show me 22K necklaces under Rs 500,000");
  const reply = page.getByTestId("msg-assistant").last();
  await expect(reply.getByRole("listitem")).toHaveCount(1);
  await expect(reply.getByRole("listitem")).toContainText("STG-NK-001");
  await expect(reply).toContainText("PKR 495,000");

  await sendChat(page, "What is the price of STG-RG-001?");
  await expect(page.getByTestId("msg-assistant").last()).toContainText("price to be confirmed by our team");

  await sendChat(page, "Are STG-BG-001 bangles available?");
  await expect(page.getByTestId("msg-assistant").last()).toContainText("our team will confirm availability");

  await sendChat(page, "I would like to speak to a salesperson");
  await expect(panel).toContainText("Our team will assist you with this request.");
  await page.screenshot({ path: "test-results/staging-chat.png" });

  // History comes back from the database, not the browser.
  await page.reload();
  const again = await openChat(page);
  await expect(again.getByTestId("msg-customer")).toHaveCount(4);
  await expect(again).toContainText("Show me 22K necklaces under Rs 500,000");
});
