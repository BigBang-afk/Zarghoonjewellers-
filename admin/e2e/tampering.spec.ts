import { expect, test } from "@playwright/test";
import { login, logout, PASSWORD, resetDemo } from "./helpers";

test.skip(!PASSWORD, "Set E2E_DEMO_PASSWORD (the dashboard's ZARGHOON_DEMO_PASSWORD)");

/**
 * Hidden form fields are only conveniences. A salesperson who edits one to
 * point at a colleague's record is refused by the server.
 */
test("a tampered follow-up id is refused on the server", async ({ page }) => {
  await resetDemo(page);
  await login(page, "demo-sales2"); // Sara owns the overdue follow-up
  await page.goto("/followups?tab=overdue");
  const saraFollowupId = await page.getByTestId("complete-followup").locator('input[name="followupId"]').first().inputValue();
  await logout(page);

  await login(page, "demo-sales"); // Ali
  await page.goto("/followups?tab=today");
  const form = page.getByTestId("complete-followup").first();
  await form.locator('input[name="followupId"]').evaluate((el, id) => ((el as HTMLInputElement).value = id), saraFollowupId);
  await form.getByRole("button").click();
  await expect(form.getByTestId("action-error")).toContainText("not found");
  await logout(page);

  // Sara's follow-up is still pending.
  await login(page, "demo-sales2");
  await page.goto("/followups?tab=overdue");
  await expect(page.getByTestId("followup-item")).toHaveCount(1);
});

test("the public health check says only up or down", async ({ request }) => {
  const res = await request.get("/api/health", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  // Everything else under /api still requires a session.
  const other = await request.get("/api/anything", { maxRedirects: 0 });
  expect(other.status()).toBe(307);
});
