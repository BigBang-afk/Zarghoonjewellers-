import { expect, type Page } from "@playwright/test";

export async function openChat(page: Page) {
  await page.getByTestId("chat-launcher").click();
  const panel = page.getByTestId("chat-panel");
  await expect(panel).toBeVisible();
  return panel;
}

export async function sendChat(page: Page, text: string) {
  const before = await page.getByTestId("msg-customer").count();
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("msg-customer")).toHaveCount(before + 1);
  await expect(page.getByTestId("typing-indicator")).toHaveCount(0, { timeout: 45_000 });
}

/** Fresh demo data so tests don't depend on each other. */
export async function resetDemo(page: Page) {
  const res = await page.request.post("/api/chat/reset", {
    headers: { "x-zarghoon-chat": "1", "content-type": "application/json" },
    data: { scope: "demo" },
  });
  expect(res.ok()).toBe(true);
}
