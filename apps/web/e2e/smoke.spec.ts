import { expect, test } from '@playwright/test';

/**
 * Smoke: critical product routes render chrome.
 * Requires web (+ optionally API) running. Set PLAYWRIGHT_SKIP=1 to no-op.
 * Set PLAYWRIGHT_E2E_LOGIN=1 to exercise credentials login against a seeded stack.
 */
const skip = process.env.PLAYWRIGHT_SKIP === '1';
const loginE2E = process.env.PLAYWRIGHT_E2E_LOGIN === '1';

test.describe('Phase 3 product routes', () => {
  test.skip(skip, 'PLAYWRIGHT_SKIP=1');

  test('login page loads', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText(/Git With It|Sign|Login|email/i);
  });

  test('repo section paths are routable (redirect to login when unauthenticated)', async ({
    page,
  }) => {
    const paths = [
      '/demo/repos/00000000-0000-0000-0000-000000000001/overview',
      '/demo/repos/00000000-0000-0000-0000-000000000001/graph',
      '/demo/repos/00000000-0000-0000-0000-000000000001/timeline',
      '/demo/repos/00000000-0000-0000-0000-000000000001/metrics',
      '/demo/repos/00000000-0000-0000-0000-000000000001/compare',
      '/demo/repos/00000000-0000-0000-0000-000000000001/insights',
    ];
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(500);
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});

test.describe('Authenticated shell', () => {
  test.skip(skip || !loginE2E, 'PLAYWRIGHT_E2E_LOGIN=1 required');

  test('login reaches org repos list', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', process.env.SEED_ADMIN_EMAIL ?? 'admin@git-with-it.local');
    await page.fill('#password', process.env.SEED_ADMIN_PASSWORD ?? 'admin1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/.*\/repos/, { timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/repo|Connect|Git With It/i);

    const overview = page.url().replace(/\/repos.*/, '/repos');
    await page.goto(overview);
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
