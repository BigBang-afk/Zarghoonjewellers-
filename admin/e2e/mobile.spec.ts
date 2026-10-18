import { expect, test } from "@playwright/test";
import { login, PASSWORD } from "./helpers";

test.skip(!PASSWORD, "Set E2E_DEMO_PASSWORD (the dashboard's ZARGHOON_DEMO_PASSWORD)");

test("mobile: menu navigation and no horizontal page scroll", async ({ page }) => {
  await login(page, "demo-owner");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Customers" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0); // the table scrolls inside its own box
  await page.goto("/followups");
  expect(await overflow()).toBeLessThanOrEqual(0);
});
