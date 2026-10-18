import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user").first()).toBeAttached({ timeout: 30_000 });
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

/** Owner resets the demo database so each test starts from the same fake data. */
export async function resetDemo(page: Page) {
  await login(page, "demo-owner");
  await page.goto("/settings");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("reset-demo").getByRole("button").click();
  await expect(page).toHaveURL(/\/login\?reset=1/, { timeout: 60_000 });
}

export function stat(page: Page, label: string) {
  return page.getByTestId(`stat-${label}`);
}
