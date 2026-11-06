import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests boot the production build and check each route renders inside the
 * shared shell. Run with `pnpm --filter @nexxore/web test:e2e` (requires
 * `pnpm --filter @nexxore/web exec playwright install chromium` once).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
