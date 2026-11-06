import { defineConfig } from "@playwright/test";

// The stack: the demo chain (make demo-chain + make hook-pool, :8545) must already be running.
// Global setup snapshots it and starts the engine (:8000), which also serves the page.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.RISKPILOT_URL ?? "http://localhost:8000",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
