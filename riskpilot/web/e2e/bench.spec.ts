// Latency bench for the hardening PR (BENCH=1 npx playwright test bench). Writes BENCH_OUT (JSON).
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { rpc, startEngine, stopEngine } from "./stack";

test.skip(!process.env.BENCH, "bench only: BENCH=1");

const out: Record<string, number | string> = {};
const runs = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("bench", async ({ page }) => {
  test.setTimeout(300_000);
  // 1. Page load to first full render: every opportunity row, the hook fee, the Aqua curves, history.
  const loads: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await page.goto("/riskpilot");
    await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5, { timeout: 30_000 });
    await expect(page.getByTestId("hook-fee")).toBeVisible();
    await expect(page.locator("#aqua .curve").first()).toBeVisible();
    await expect(page.locator("[data-testid=history-row]").first()).toBeVisible();
    loads.push(Date.now() - t);
  }
  out.page_load_ms = median(loads);

  // 2. Block to verdict on screen: mine a block and wait for the selected decision id to change.
  const before = await page.getByTestId("decision").getAttribute("data-decision");
  const t2 = Date.now();
  await rpc("evm_mine");
  try {
    await expect(page.getByTestId("decision")).not.toHaveAttribute("data-decision", before!, { timeout: 10_000 });
    out.block_to_verdict_ms = Date.now() - t2;
  } catch { out.block_to_verdict_ms = "never (no re-evaluation on a new block)"; }

  // 3. Click to first wallet prompt (the first transaction handed to the signer).
  const snap = await rpc<string>("evm_snapshot");
  await page.goto("/riskpilot");
  await page.locator('[data-testid=opp-row][data-label^="Price gap · hooked"]').click();
  const btn = page.getByTestId("approve");
  await expect(btn).toBeEnabled();
  await page.evaluate(() => {
    const w = window as any;
    w.__firstSign = 0;
    new MutationObserver(() => {
      if (!w.__firstSign && /sign|Signing \d/.test(document.getElementById("log")?.textContent ?? "")) w.__firstSign = performance.now();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const clickAt = await page.evaluate(() => performance.now());
  await btn.click();
  await page.waitForFunction(() => (window as any).__firstSign > 0, null, { timeout: 30_000 });
  out.click_to_wallet_ms = Math.round((await page.evaluate(() => (window as any).__firstSign)) - clickAt);
  await page.waitForTimeout(3000);
  await rpc("evm_revert", [snap]);

  // 4. Engine down (real kill) to "Source unavailable".
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  const t4 = Date.now();
  await stopEngine();
  await expect(page.locator("#opps")).toContainText("Source unavailable", { timeout: 20_000 });
  out.engine_down_ms = Date.now() - t4;
  await startEngine();

  writeFileSync(process.env.BENCH_OUT ?? "bench.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
});
