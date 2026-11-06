// make snapshot: record the page's engine and demo-chain responses at the frozen block into
// web/snapshot.json, which the public page (nexxore.xyz/riskpilot, /intelligence) replays read-only.
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, installWallet } from "./stack";

test.skip(!process.env.RECORD, "recording only: RECORD=1 E2E_EXTERNAL=1");

test("record the demo", async ({ page }) => {
  test.setTimeout(120_000);
  await installWallet(page);
  await page.goto("/riskpilot?record=1");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  await expect(page.locator("#hook svg")).toBeAttached({ timeout: 20_000 });
  await expect(page.locator("#aqua .curve").first()).toBeAttached();
  for (const label of ["Price gap · hooked", "Price gap · static", "Price gap · v4 ETH/USDC", "Put-like", "Call-like"]) {
    await page.locator(`[data-testid=opp-row][data-label^="${label}"]`).click();
  }
  for (const t of [2, 3, 4, 1]) { await page.getByTestId(`tab-${t}`).click(); await page.waitForTimeout(600); }
  await page.waitForTimeout(2500); // the next block's renders settle
  const rec = await page.evaluate(() => (window as any).__rp_record());
  expect(rec.stream?.items?.length).toBe(5);
  expect(Object.keys(rec.rpc).length).toBeGreaterThan(5);
  writeFileSync(join(ROOT, "web", "snapshot.json"), JSON.stringify(rec));
  console.log(`snapshot: ${Object.keys(rec.engine).length} engine responses, ${Object.keys(rec.rpc).length} chain responses, block ${rec.stream.block}`);
});
