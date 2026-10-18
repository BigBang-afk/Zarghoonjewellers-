import { expect, test } from "@playwright/test";
import { login, logout, PASSWORD, resetDemo, stat } from "./helpers";

test.skip(!PASSWORD, "Set E2E_DEMO_PASSWORD (the dashboard's ZARGHOON_DEMO_PASSWORD)");

test.describe("authentication", () => {
  test("pages need a session; security headers are set", async ({ page, request }) => {
    const res = await request.get("/customers", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/login");
    const login = await request.get("/login");
    expect(login.headers()["x-frame-options"]).toBe("DENY");
    expect(login.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(login.headers()["x-robots-tag"]).toContain("noindex");
    expect(login.headers()["cache-control"]).toMatch(/no-store|no-cache/);
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("demo-banner")).toHaveText(/development demo — fake data/i);
  });

  test("wrong password is refused without saying which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("demo-owner");
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("login-form").getByRole("alert")).toHaveText("Incorrect username or password.");
  });

  test("a forged or reused cookie does not work after sign-out", async ({ page, context }) => {
    const url = "http://localhost:3100";
    await context.addCookies([
      { name: "zj_staff", value: "forged-token", url },
      { name: "__Host-zj_staff", value: "forged-token", domain: "localhost", path: "/", secure: true },
    ]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await context.clearCookies();
    await login(page, "demo-manager");
    const token = (await context.cookies()).find((c) => c.name.endsWith("zj_staff"))!;
    expect(token.httpOnly).toBe(true);
    expect(token.sameSite).toBe("Strict");
    await logout(page);
    await context.addCookies([{ name: token.name, value: token.value, domain: token.domain, path: token.path, secure: token.secure }]);
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("owner views (fresh demo data)", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("overview shows counted metrics, pipeline and activity", async ({ page }) => {
    await login(page, "demo-owner");
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(stat(page, "Customers")).toContainText("9");
    await expect(stat(page, "Very hot leads")).toContainText("1");
    await expect(stat(page, "Hot leads")).toContainText("1");
    await expect(stat(page, "Overdue follow-ups")).toContainText("1");
    await expect(stat(page, "Human handoffs")).toContainText("2");
    await expect(stat(page, "Low stock")).toContainText("1");
    await expect(stat(page, "Revenue")).toContainText("PKR 98,000");
    await expect(page.getByTestId("pipeline")).toContainText("Very hot");
    await expect(page.getByTestId("recent-activity").getByRole("listitem").first()).toBeVisible();
  });

  test("customers: search, then Customer 360 with score breakdown and message senders", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/customers");
    await expect(page.getByTestId("customer-row")).toHaveCount(9);
    await page.getByLabel("Search customers").fill("ayesha");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("customer-row")).toHaveCount(1);
    await page.getByRole("link", { name: "DEMO Ayesha Khan (fake)" }).click();
    await expect(page.getByRole("heading", { name: "DEMO Ayesha Khan (fake)" })).toBeVisible();
    const breakdown = page.getByTestId("score-breakdown");
    await expect(breakdown).toContainText("85");
    await expect(breakdown).toContainText("Asked about visiting");
    await expect(breakdown).toContainText("+20");
    const thread = page.getByTestId("message-thread").first();
    await expect(thread.locator('[data-sender="customer"]').first()).toContainText("Customer");
    await expect(thread.locator('[data-sender="ai"]').first()).toContainText("Zarghoon AI");
    await expect(thread.locator('[data-sender="staff"]').first()).toContainText("Staff · DEMO Salesperson Ali");
    await expect(page.getByText("DEMO-NK-001").first()).toBeVisible();
    await expect(page.getByText("No orders recorded")).toBeVisible();
  });

  test("leads: hot and very hot filters", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/leads");
    await page.getByRole("link", { name: "Very hot", exact: true }).click();
    await expect(page.getByTestId("lead-row")).toHaveCount(1);
    await expect(page.getByTestId("lead-row")).toContainText("DEMO Ayesha Khan");
    await expect(page.getByTestId("lead-row")).toContainText("PKR 500,000");
    await page.getByRole("link", { name: "Hot", exact: true }).click();
    await expect(page.getByTestId("lead-row")).toContainText("DEMO Bilal Ahmed");
  });

  test("products: stock filter, missing information and Needs confirmation", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/products?stock=low_stock");
    await expect(page.getByTestId("product-row")).toHaveCount(1);
    await expect(page.getByTestId("product-row")).toContainText("DEMO-BG-002");
    await page.goto("/products?missing=price");
    const row = page.getByTestId("product-row").filter({ hasText: "DEMO-NK-002" });
    await expect(row).toContainText("Needs confirmation");
    await row.getByRole("link").first().click();
    await expect(page.getByTestId("missing-fields")).toContainText("price");
    await expect(page.getByText("Internal costs")).toBeVisible();
    await page.goto("/products/sync");
    await expect(page.getByText("Batches awaiting or after approval")).toBeVisible();
  });

  test("empty states", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/customers?q=no-such-customer-xyz");
    await expect(page.getByTestId("empty-state")).toContainText("No customers match");
    await page.goto("/handoffs?status=resolved");
    await expect(page.getByTestId("empty-state")).toBeVisible();
  });
});

test.describe("salesperson permissions and actions", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("sees only assigned customers; other records are not found; no approvals or audit", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/customers?q=bilal");
    const bilalHref = await page.getByRole("link", { name: "DEMO Bilal Ahmed (fake)" }).getAttribute("href");
    await logout(page);

    await login(page, "demo-sales");
    await page.goto("/customers");
    await expect(page.getByTestId("customer-row")).toHaveCount(4);
    await expect(page.getByText("DEMO Bilal Ahmed")).toHaveCount(0);
    await page.goto(bilalHref!);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Approvals" })).toHaveCount(0);
    await page.goto("/approvals");
    await expect(page.getByTestId("not-permitted")).toBeVisible();
    await page.goto("/activity");
    await expect(page.getByTestId("not-permitted")).toBeVisible();
  });

  test("follow-ups: complete today's and schedule a new one", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/followups?tab=today");
    const item = page.getByTestId("followup-item").filter({ hasText: "DEMO Ayesha Khan" });
    await item.getByLabel("Outcome").fill("Visit confirmed for Saturday");
    await item.getByTestId("complete-followup").getByRole("button").click();
    await expect(page.getByTestId("toast").last()).toHaveText("Follow-up completed.");
    await page.goto("/followups?tab=completed");
    await expect(page.getByText("Visit confirmed for Saturday")).toBeVisible();

    await page.goto("/customers?q=usman");
    await page.getByRole("link", { name: "DEMO Usman Tariq (fake)" }).click();
    const form = page.getByTestId("schedule-followup");
    await form.getByRole("combobox").selectOption("service");
    await form.getByPlaceholder("What to follow up about").fill("Ring resizing");
    await form.getByRole("button", { name: "Schedule follow-up" }).click();
    await expect(page.getByTestId("toast").last()).toContainText("Follow-up scheduled");
  });

  test("do-not-contact customers cannot get follow-ups", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/customers?q=sana");
    await page.getByRole("link", { name: "DEMO Sana Iqbal (fake)" }).click();
    await expect(page.getByText("asked not to be contacted").first()).toBeVisible();
    await expect(page.getByTestId("schedule-followup")).toHaveCount(0);
  });

  test("human handoff: take over, then resolve and hand back to the AI", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/handoffs");
    const item = page.getByTestId("handoff-item").filter({ hasText: "Discount request" });
    await item.getByTestId("take-over").getByRole("button").click();
    await expect(page.getByTestId("toast").last()).toContainText("taken over");
    await expect(item).toContainText("Assigned to: DEMO Salesperson Ali");
    await item.getByRole("link", { name: "Open conversation →" }).click();
    await expect(page.getByText("Human takeover — AI paused")).toBeVisible();
    await page.goto("/handoffs");
    const mine = page.getByTestId("handoff-item").filter({ hasText: "Discount request" });
    await mine.getByLabel("Hand the conversation back to the AI").check();
    await mine.getByTestId("resolve-handoff").getByRole("button").click();
    await expect(page.getByTestId("toast").last()).toContainText("the AI may reply again");
    await page.goto("/handoffs?status=resolved");
    await expect(page.getByTestId("handoff-item").filter({ hasText: "Discount request" })).toBeVisible();
  });

  test("lead: add a note; won/lost need staff", async ({ page }) => {
    await login(page, "demo-sales");
    await page.goto("/leads");
    await page.getByRole("link", { name: "DEMO Usman Tariq (fake)" }).click();
    await page.getByLabel("Note", { exact: true }).fill("Prefers white gold");
    await page.getByTestId("add-note").getByRole("button").click();
    await expect(page.getByTestId("lead-notes")).toContainText("DEMO Salesperson Ali] Prefers white gold");
    await expect(page.getByTestId("assign-lead")).toHaveCount(0); // managers only
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("mark-lost").getByRole("button").click();
    // Browser validation requires a reason before anything is sent.
    await expect(page.getByLabel("Lost reason")).toHaveJSProperty("validity.valueMissing", true);
  });
});

test.describe("approvals and audit (owner)", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("approve a pending request; it moves to history and the audit log", async ({ page }) => {
    await login(page, "demo-owner");
    await page.goto("/approvals");
    const item = page.getByTestId("approval-item").filter({ hasText: "Discount" });
    await item.getByLabel("Rejection reason").fill("No discount on bridal sets");
    page.once("dialog", (d) => d.accept());
    await item.getByTestId("reject").getByRole("button").click();
    await expect(page.getByTestId("toast").last()).toHaveText("Rejected.");
    await page.goto("/approvals?status=rejected");
    await expect(page.getByText("No discount on bridal sets")).toBeVisible();
    await page.goto("/activity?category=sensitive");
    await expect(page.getByTestId("activity-row").filter({ hasText: "Approval rejected" }).first()).toContainText("DEMO Owner");
    await page.goto("/approvals?kind=imports");
    await expect(page.getByTestId("approval-item").filter({ hasText: "Product sync" })).toBeVisible();
  });

  test("reset demo data restores the fake dataset", async ({ page }) => {
    await resetDemo(page);
    await expect(page.getByText("Demo data was reset")).toBeVisible();
    await login(page, "demo-owner");
    await expect(stat(page, "Human handoffs")).toContainText("2");
  });
});
