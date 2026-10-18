import { expect, test } from "@playwright/test";

/** 18. The existing website keeps working with the chat added. */

test("home page renders hero, collections and footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Timeless Jewellery/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Our Collections" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the Zarghoon Family" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Zarghoon Jewellers");
});

test("login and register pages render", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /log ?in|sign ?in/i })).toBeVisible();
  await page.goto("/register");
  await expect(page.locator("form")).toBeVisible();
});

test("admin area still requires login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("admin can sign in with a seeded account and the chat stays off admin pages", async ({ page }) => {
  const username = process.env.E2E_ADMIN_USERNAME;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!username || !password, "Set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD to test admin login");
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(username!);
  await page.getByLabel(/password/i).fill(password!);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId("chat-launcher")).toHaveCount(0);
});

test("a short weak password cannot be used to sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill("admin");
  await page.getByLabel(/password/i).fill("not-the-password");
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("repeated wrong passwords lock the account for a while, even with the right password (step 12)", async ({ page }) => {
  const username = `e2e_lock_${Date.now().toString(36)}`;
  const password = "Correct-horse-42";
  const res = await page.request.post("/api/register", {
    data: { fullName: "E2E Lockout (fake)", username, password, dob: "1990-01-01", mobile: "+12025550199" },
  });
  expect(res.ok()).toBe(true);

  const attempt = async (pw: string) => {
    await page.goto("/login");
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(pw);
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await page.waitForLoadState("networkidle");
  };
  for (let i = 0; i < 5; i++) {
    await attempt(`wrong-password-${i}`);
    await expect(page).toHaveURL(/\/login/);
  }
  await attempt(password);
  await expect(page).toHaveURL(/\/login/);
});

test("the admin product API refuses cross-site requests", async ({ page }) => {
  const res = await page.request.delete("/api/admin/products/00000000-0000-0000-0000-000000000000", {
    headers: { origin: "https://evil.example" },
  });
  expect(res.status()).toBe(403);
});
