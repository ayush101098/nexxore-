// Backup demo (RUNTHROUGH=1 npx playwright test runthrough): one unreloaded run of the PRD 6 flow,
// paced to ~4 minutes, recorded to video. Skipped in the normal e2e run.
import { expect, test } from "@playwright/test";
import { startEngine, stopEngine, takerFill } from "./stack";

test.skip(!process.env.RUNTHROUGH, "set RUNTHROUGH=1 to record the backup run-through");
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } });
test.setTimeout(420_000);

const pause = (page, s: number) => page.waitForTimeout(s * 1000);

test("4-minute run-through", async ({ page }) => {
  const row = (label: string) => page.locator(`[data-testid=opp-row][data-label^="${label}"]`);
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(3);
  await expect(page.locator("#hook svg")).toBeVisible();
  await pause(page, 14); // status bar: chain, wallet, holdings, profile; three proposals

  await row("Price gap").click(); await pause(page, 6);
  await page.locator("#decision svg .hit").nth(3).hover(); await pause(page, 14); // the hook's 1% fee and slippage eat the gap

  await row("Put-like").click(); await pause(page, 8);
  await page.getByText("14 stress scenarios").click(); await pause(page, 14); // -40% spot drives the loss
  await page.getByText("14 stress scenarios").click();

  await row("Call-like").click(); await pause(page, 4);
  const reeval = page.locator("#reeval");
  if (await reeval.isVisible()) { await reeval.click(); await pause(page, 3); }
  await expect(page.getByTestId("approve")).toBeEnabled();
  await page.locator("dt", { hasText: "T_eq" }).locator("button").hover(); await pause(page, 6);

  await page.getByTestId("approve").click(); // collateral check, approve WETH, simulate, ship, verify
  await expect(page.locator("#log")).toContainText("verified · engine position", { timeout: 60_000 });
  await pause(page, 12);

  await page.getByRole("button", { name: "View API" }).click(); await pause(page, 18); // the same /evaluate any agent calls
  await page.getByRole("button", { name: "Close" }).click(); await pause(page, 3);

  await page.locator("#h-pos").scrollIntoViewIfNeeded(); await pause(page, 6);
  takerFill("upside");
  await expect(page.getByTestId("fill-tx").first()).toBeVisible({ timeout: 20_000 }); await pause(page, 6);
  await page.getByTestId("ship-tx").first().getByRole("button", { name: "Verify" }).click(); await pause(page, 5);
  await page.getByTestId("fill-tx").first().getByRole("button", { name: "Verify" }).click(); await pause(page, 10);

  const hook = page.locator("#hook svg .hit");
  for (const i of [2, 6, 10, 14]) { await hook.nth(i).hover(); await pause(page, 3); } // fee rises with sigma
  await pause(page, 8);

  await page.locator("#h-hist").scrollIntoViewIfNeeded(); await pause(page, 6);
  const reject = page.locator("[data-testid=history-row][data-verdict=REJECT]").first();
  await reject.getByRole("button", { name: "Replay" }).click();
  await expect(reject.getByTestId("replay-result")).toContainText("identical"); await pause(page, 14);

  await page.evaluate(() => window.scrollTo(0, 0)); await pause(page, 4);
  await stopEngine(); // every panel says so; nothing stale stays on screen
  await expect(page.locator("#opps")).toContainText("Source unavailable: engine", { timeout: 5_000 });
  await pause(page, 14);
  await startEngine(); // and it recovers on its own
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(3, { timeout: 15_000 });
  await pause(page, 16);
});
