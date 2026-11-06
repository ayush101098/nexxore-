// Latency bench for the hardening PR (BENCH=1 npx playwright test bench). Writes BENCH_OUT (JSON).
// Works on the pre-hardening page too (no profile cards, no stream), for the "before" column.
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { ENGINE_URL, rpc, startEngine, stopEngine } from "./stack";

test.skip(!process.env.BENCH, "bench only: BENCH=1");

const out: Record<string, number | string> = {};
const runs = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

test("bench", async ({ page }) => {
  test.setTimeout(300_000);
  // Warm-up, and the one-time profile choice on the new page.
  await page.goto("/riskpilot");
  const card = page.locator("[data-testid=profile-card][data-profile=moderate]");
  await Promise.race([card.waitFor({ timeout: 15_000 }), page.locator("[data-testid=opp-row]").first().waitFor({ timeout: 15_000 })]);
  if (await card.isVisible()) await card.click();
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5, { timeout: 30_000 });

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
  const ticks: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = await page.getByTestId("decision").getAttribute("data-decision");
    const t = Date.now();
    await rpc("evm_mine");
    try {
      await expect(page.getByTestId("decision")).not.toHaveAttribute("data-decision", before!, { timeout: 10_000 });
      ticks.push(Date.now() - t);
    } catch { out.block_to_verdict_ms = "never (no re-evaluation on a new block)"; break; }
  }
  if (ticks.length) out.block_to_verdict_ms = median(ticks);

  // 3. /evaluate p95: 40 fully resolved requests per seeded decision, as an agent would send them.
  const seed = await page.evaluate(() => (window as any).__riskpilot?.seed ?? null)
    ?? await (await fetch(`${ENGINE_URL}/demo/seed`, { method: "POST" })).json();
  const lat: number[] = [];
  for (const it of seed.items) {
    const r = it.decision.inputs.request;
    const body = JSON.stringify({ opportunity: r.opportunity, size: r.size, profile: r.profile, market: r.market, book: r.book,
      as_of: r.as_of, tolerance: r.tolerance, gas_budget: r.gas_budget, aqua: r.aqua, holdings: r.holdings });
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      await fetch(`${ENGINE_URL}/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body });
      lat.push(performance.now() - t);
    }
  }
  out.evaluate_p50_ms = Math.round(pct(lat, 0.5) * 10) / 10;
  out.evaluate_p95_ms = Math.round(pct(lat, 0.95) * 10) / 10;

  // 4. Click to first wallet prompt (the first transaction handed to the signer).
  const snap = await rpc<string>("evm_snapshot");
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  await page.locator('[data-testid=opp-row][data-label^="Price gap · hooked"]').click();
  const btn = page.getByTestId("approve");
  await expect(btn).toBeEnabled();
  await page.evaluate(() => {
    const w = window as any;
    w.__firstSign = 0;
    new MutationObserver(() => {
      if (!w.__firstSign && /· sign|Signing \d/.test((document.getElementById("log")?.textContent ?? "") + (document.getElementById("approve")?.textContent ?? ""))) w.__firstSign = performance.now();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const clickAt = await page.evaluate(() => performance.now());
  await btn.click();
  await page.waitForFunction(() => (window as any).__firstSign > 0, null, { timeout: 30_000 })
    .catch(async (e) => { console.log("log:", await page.locator("#log").textContent(), "| button:", await btn.textContent()); throw e; });
  out.click_to_wallet_ms = Math.round((await page.evaluate(() => (window as any).__firstSign)) - clickAt);
  await page.waitForTimeout(3000);
  await rpc("evm_revert", [snap]);

  // 5. Engine down (SIGKILL) to "Source unavailable".
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  const t5 = Date.now();
  await stopEngine("SIGKILL");
  await expect(page.locator("#opps")).toContainText("Source unavailable", { timeout: 20_000 });
  out.engine_down_ms = Date.now() - t5;
  await startEngine();

  writeFileSync(process.env.BENCH_OUT ?? "bench.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
});
