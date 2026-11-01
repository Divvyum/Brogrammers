import { expect, test } from "@playwright/test";

// Sign-in paths in local development (emulators): Google picker and email link.

test("Google sign-in: the emulator lists seeded accounts and signs in with their role", async ({ page, context }) => {
  await page.goto("/");
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /Continue with Google/ }).click()]);
  await popup.waitForLoadState();
  await expect(popup.getByText("organizer1@hackos.test")).toBeVisible();
  await popup.getByText("organizer1@hackos.test").click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.locator(".account small")).toHaveText("organizer");
});

test("email link sign-in works locally via the emulator's link", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("judge1@hackos.test");
  await page.getByRole("button", { name: /Send sign-in link/ }).click();
  await page.getByRole("link", { name: /Open sign-in link/ }).click();
  await expect(page).toHaveURL(/\/judge$/, { timeout: 20_000 });
});
