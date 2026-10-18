import { expect, test } from "@playwright/test";
import { login, logout, PASSWORD, resetDemo } from "./helpers";

test.skip(!PASSWORD, "Set E2E_DEMO_PASSWORD (the dashboard's ZARGHOON_DEMO_PASSWORD)");

const toast = (page: import("@playwright/test").Page) => page.getByTestId("toast").last();

test.describe("AI Follow-up Center (demo data, nothing is sent)", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("1–5. open the center, select a customer, generate, edit and approve a draft", async ({ page }) => {
    await login(page, "demo-sales");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /AI Follow-ups/ }).first().click();
    await expect(page.getByRole("heading", { name: "AI Follow-up Center" })).toBeVisible();
    await expect(page.getByText("Offline templates — not AI")).toBeVisible();

    await page.getByRole("link", { name: /Drafts to review/ }).click();
    const ayesha = page.getByTestId("followup-item").filter({ hasText: "DEMO Ayesha Khan" });
    await expect(ayesha.getByTestId("draft-card")).toContainText("DEMO Bridal Kundan Necklace");
    await ayesha.getByTestId("followup-link").click();
    await expect(page.getByTestId("eligibility")).toContainText("Eligible");

    await page.getByTestId("generate-draft").getByRole("button").click();
    await expect(toast(page)).toContainText("safe template");
    await expect(page.getByTestId("draft-history").getByTestId("draft-card")).toHaveCount(2);

    // Prohibited content is refused on the server.
    await page.getByLabel("Draft message").fill("Assalamualaikum! Special 20% discount on the bridal set this week only!");
    await page.getByTestId("edit-draft").getByRole("button").click();
    await expect(page.getByTestId("edit-draft").getByTestId("action-error")).toContainText("unverified or prohibited");

    await page.getByLabel("Draft message").fill("Assalamualaikum Ayesha! Ali from Zarghoon Jewellers — would Saturday afternoon suit you to see the DEMO Bridal Kundan Necklace Set in store?");
    await page.getByTestId("edit-draft").getByRole("button").click();
    await expect(toast(page)).toContainText("waiting for approval");
    await expect(page.getByTestId("draft-card").first()).toContainText("Written by staff");

    await page.getByTestId("approve-draft").getByRole("button").click();
    await expect(toast(page)).toHaveText("Approved for a future permitted channel. It has not been sent.");
    await expect(page.getByTestId("draft-card").first()).toContainText("Approved — not sent");
    await expect(page.getByTestId("followup-audit")).toContainText("Followup draft approved");
  });

  test("5b. reject a draft (Sara) and other staff cannot open it", async ({ page }) => {
    await login(page, "demo-sales2");
    await page.goto("/followups?tab=review");
    await page.getByTestId("followup-item").filter({ hasText: "DEMO Bilal Ahmed" }).getByTestId("followup-link").click();
    await page.waitForURL(/\/followups\/[0-9a-f-]{36}$/);
    const url = page.url();
    await page.getByLabel("Rejection reason").fill("Customer prefers a call");
    await page.getByTestId("reject-draft").getByRole("button").click();
    await expect(toast(page)).toHaveText("Draft rejected.");
    await logout(page);
    await login(page, "demo-sales");
    await page.goto(url);
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("6. reschedule a follow-up (quiet hours respected)", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/followups?tab=upcoming");
    await page.getByTestId("followup-item").filter({ hasText: "DEMO Usman Tariq" }).getByTestId("followup-link").click();
    // Tomorrow at 23:30 Karachi time — inside quiet hours (21:00–10:00).
    const tomorrow = new Date(Date.now() + 5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("New time").fill(`${tomorrow}T23:30`);
    await page.getByTestId("reschedule").getByRole("button").click();
    await expect(toast(page)).toContainText("moved out of quiet hours");
    await expect(page.getByText("(moved out of quiet hours)")).toBeVisible();
  });

  test("7. do-not-contact and missing consent are enforced", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/customers?q=sana");
    await page.getByRole("link", { name: "DEMO Sana Iqbal (fake)" }).click();
    await expect(page.getByText("Do not contact: no follow-ups of any kind.")).toBeVisible();
    await expect(page.getByTestId("schedule-followup")).toHaveCount(0);
    await logout(page);

    await login(page, "demo-sales2");
    await page.goto("/customers?q=kamran");
    await page.getByRole("link", { name: "DEMO Kamran Shah (fake)" }).click();
    await expect(page.getByTestId("consent-status")).toContainText("Unknown");
    const form = page.getByTestId("schedule-followup");
    await form.getByLabel("Follow-up type").selectOption("price_inquiry");
    await form.getByRole("button", { name: "Schedule follow-up" }).click();
    await expect(form.getByTestId("action-error")).toContainText("No messaging consent recorded");
  });

  test("8. history, notifications and honest analytics", async ({ page }) => {
    await login(page, "demo-manager");
    await page.goto("/followups?tab=history");
    await expect(page.getByTestId("followup-item").first()).toBeVisible();
    await page.goto("/followups?tab=attention");
    await expect(page.getByTestId("followup-item").filter({ hasText: "Processing failed" })).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Notifications/ }).first().click();
    await expect(page.getByTestId("notification").filter({ hasText: "Follow-up processing failed" })).toBeVisible();
    await page.getByTestId("mark-all-read").getByRole("button").click();
    await expect(toast(page)).toContainText("marked as read");

    await page.goto("/followups/analytics");
    await expect(page.getByTestId("na-3. Delivered")).toContainText("Not available");
    await expect(page.getByTestId("na-Follow-up to sale conversion")).toContainText("Not available");

    await page.goto("/followups");
    await page.getByTestId("run-worker").getByRole("button").click();
    await expect(toast(page)).toContainText("Nothing was sent.");
  });
});
