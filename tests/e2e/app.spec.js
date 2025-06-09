// @ts-check
import { test, expect } from '@playwright/test';

test('homepage has Notention title and app shell', async ({ page }) => {
  await page.goto('/index.html'); // Path relative to baseURL (http://localhost:3000)

  // Check the title
  await expect(page).toHaveTitle(/Notention/);

  // Check if the app shell loads (e.g., the main sidebar and view)
  const appShell = page.locator('#app-shell');
  await expect(appShell).toBeVisible();

  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeVisible();

  const mainView = page.locator('#main-view');
  await expect(mainView).toBeVisible();
});
