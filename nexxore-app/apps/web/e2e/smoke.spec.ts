import { test, expect } from '@playwright/test';

/** One smoke test per ported page (GLOBAL RULE 6). */
const PAGES = [
  { path: '/', name: 'home' },
  { path: '/terminal', name: 'terminal' },
  { path: '/predictions', name: 'predictions' },
  { path: '/strategy', name: 'strategy' },
  { path: '/stablecoin-hub', name: 'stablecoin-hub' },
  { path: '/vaults', name: 'vaults' },
];

for (const page of PAGES) {
  test(`${page.name} renders inside the shared shell`, async ({ page: p }) => {
    await p.goto(page.path);
    // Shared nav + regime chip present.
    await expect(p.locator('.nx-nav__logo')).toHaveText('NEXXORE');
    await expect(p.getByRole('status', { name: /Market regime/ })).toBeVisible();
    // Shared footer present.
    await expect(p.locator('.nx-footer')).toBeVisible();
  });
}

test('product routes serve the ported legacy frame', async ({ page }) => {
  await page.goto('/terminal');
  await expect(page.locator('iframe[title="NEXXORE Terminal"]')).toBeVisible();
});
