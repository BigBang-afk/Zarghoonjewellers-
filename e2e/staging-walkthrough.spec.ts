import { expect, test } from "@playwright/test";
import { openChat, sendChat } from "./helpers";

/**
 * Opt-in (E2E_WALKTHROUGH=1): the Step 12 end-to-end walkthrough across both apps
 * on ONE staging database, with fake data only.
 *
 *   website:   ZARGHOON_CHAT_MODE=staging            (this app, E2E_BASE_URL, default :3000)
 *   dashboard: ZARGHOON_DASHBOARD_MODE=connected     (admin/, E2E_DASHBOARD_URL, default :3101)
 *              ZARGHOON_DASHBOARD_DB_ENV=staging
 *   both:      ZARGHOON_CORE_DATABASE_URL = the staging zarghoon_app role
 *   E2E_STAGING_USERNAME / E2E_STAGING_PASSWORD = a staging manager account
 *
 * Each run adds one fake visitor (DEMO … (fake), 555-01xx phone, @example.invalid email).
 */
const DASH = process.env.E2E_DASHBOARD_URL ?? "http://localhost:3101";
const USER = process.env.E2E_STAGING_USERNAME;
const PASS = process.env.E2E_STAGING_PASSWORD;
test.skip(process.env.E2E_WALKTHROUGH !== "1" || !USER || !PASS, "set E2E_WALKTHROUGH=1 and the staging manager login");

test("walkthrough: chat → lead → dashboard → Customer 360 → follow-up draft → handoff stops the AI", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const tag = Date.now().toString(36).slice(-5);
  const name = `DEMO Walkthrough ${tag} (fake)`;

  // 1–2. Website and chat (staging, labelled as test data)
  await page.goto("/");
  const panel = await openChat(page);
  await expect(panel).toContainText("Staging");

  // 3–4. Budget query answered from the staging catalogue
  await sendChat(page, "Show me 22K necklaces under Rs 500,000");
  await expect(page.getByTestId("msg-assistant").last()).toContainText("STG-NK-001");
  await expect(page.getByTestId("msg-assistant").last()).toContainText("PKR 495,000");

  // 5. Demo lead (self-reported, fake)
  await page.getByRole("button", { name: "Share contact details" }).click();
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Phone / WhatsApp").fill(`+120255501${String(Math.floor(Math.random() * 90) + 10)}`);
  await page.getByPlaceholder("Email").fill(`walkthrough-${tag}@example.invalid`);
  await page.getByRole("form", { name: "Share contact details" }).getByRole("button").last().click();

  // 6–8. Dashboard
  const dash = await (await browser.newContext()).newPage();
  await dash.goto(`${DASH}/login`);
  await expect(dash.getByTestId("env-banner")).toContainText(/staging/i);
  await dash.getByLabel("Username").fill(USER!);
  await dash.getByLabel("Password").fill(PASS!);
  await dash.getByRole("button", { name: "Sign in" }).click();
  await dash.getByTestId("current-user").first().waitFor({ state: "attached" });
  await dash.goto(`${DASH}/leads`);
  await expect(dash.getByText(name).first()).toBeVisible();
  await dash.goto(`${DASH}/customers?q=${encodeURIComponent(`Walkthrough ${tag}`)}`);
  await dash.getByRole("link", { name }).first().click();
  const score = dash.getByTestId("score-breakdown");
  await expect(score).toContainText("Shared a budget");
  await expect(score).toContainText("Shared contact details");

  // 9. Consent (fake), then a follow-up
  const consent = dash.getByTestId("consent-form");
  await consent.getByLabel("Messaging consent").selectOption("granted");
  await consent.getByLabel("Consent source").fill("Fake consent for the staging walkthrough");
  await consent.getByRole("button").click();
  await expect(dash.getByTestId("toast").last()).toContainText("Consent updated");
  await dash.getByTestId("schedule-followup").getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(dash.getByTestId("toast").last()).toContainText("Nothing is sent automatically");

  // 10. Review the draft
  await dash.goto(`${DASH}/followups?tab=history`);
  await dash.getByTestId("followup-item").filter({ hasText: name }).first().getByTestId("followup-link").click();
  await expect(dash.getByTestId("eligibility")).toContainText("Eligible");
  await dash.getByTestId("generate-draft").getByRole("button").click();
  await expect(dash.getByTestId("draft-card").first()).toContainText("Pending review");

  // 11–12. Handoff, then the AI stays silent
  await sendChat(page, "I would like to speak to a salesperson");
  await expect(page.getByTestId("handoff-notice")).toBeVisible();
  const before = await page.getByTestId("msg-assistant").count();
  await sendChat(page, "Hello, is anyone there?");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("msg-assistant")).toHaveCount(before);
  await dash.goto(`${DASH}/handoffs`);
  await expect(dash.getByText(name).first()).toBeVisible();
});
