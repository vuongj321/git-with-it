import { expect, test } from '@playwright/test';

/**
 * Smoke: critical product routes render chrome.
 * Requires `pnpm --filter @gwi/web dev` (and optionally a seeded demo session).
 * Set PLAYWRIGHT_SKIP=1 to no-op in environments without a running web server.
 */
const skip = process.env.PLAYWRIGHT_SKIP === '1';

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
      // Unauthenticated clients should land on login or soft-load the shell.
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});
