import { expect, test } from "@playwright/test";
import { openChat, resetDemo, sendChat } from "./helpers";

/** 17. Mobile responsiveness. */
test("on a phone the chat opens full-screen and stays usable", async ({ page }) => {
  await page.goto("/");
  await resetDemo(page);
  const launcher = page.getByTestId("chat-launcher");
  await expect(launcher).toBeInViewport();
  const panel = await openChat(page);
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  await sendChat(page, "Show bridal jewelry");
  const cards = page.getByTestId("msg-assistant").last().getByRole("listitem");
  await expect(cards.first()).toBeVisible();
  // No horizontal page overflow: cards scroll inside their own row.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(launcher).toBeVisible();
});

test("on a phone the embedded chat on an existing site opens full-screen", async ({ page }) => {
  await page.goto("http://localhost:4000/");
  await expect(page.locator("#product-name")).toBeVisible();
  await page.getByTestId("zarghoon-ai-launcher").click();
  const frame = page.getByTestId("zarghoon-ai-frame");
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  const chat = page.frameLocator('[data-testid="zarghoon-ai-frame"] iframe');
  await expect(chat.getByTestId("chat-panel")).toBeVisible();
  await chat.getByRole("button", { name: "Close chat" }).click();
  await expect(frame).toBeHidden();
  await expect(page.locator("#add-to-cart")).toBeVisible();
});
