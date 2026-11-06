// RiskPilot /riskpilot end-to-end suite (PRD 6). Runs against the live demo chain and engine.
import { expect, test, type Page } from "@playwright/test";
import { curves, engineJson, fixed, hookDeployment, rpc, startEngine, stopEngine, takerFill, usd } from "./stack";

const row = (page: Page, label: string) => page.locator(`[data-testid=opp-row][data-label^="${label}"]`);
const money = (text: string) => Number(text.replace(/[$,\s]/g, "").replace("−", "-"));

const ROWS = 5; // three live v4 gaps + the two Aqua curves
async function open(page: Page) {
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS);
}

async function select(page: Page, label: string) {
  await row(page, label).click();
  const id = await row(page, label).getAttribute("data-decision");
  await expect(page.locator("[data-testid=decision]")).toHaveAttribute("data-decision", id!);
  return engineJson(`/decisions/${id}`);
}

test("1. load: seeded opportunities with their verdicts", async ({ page }) => {
  await open(page);
  // Live gaps on the demo chain's v4 pools: the hook's calm-market fee lets the hooked pool clear
  // the hurdle; the fork's own 0.30% pool has too small a gap for its fee.
  await expect(row(page, "Price gap · hooked").getByTestId("opp-verdict")).toHaveText("APPROVE");
  await expect(row(page, "Price gap · static").getByTestId("opp-verdict")).toHaveText("APPROVE");
  await expect(row(page, "Price gap · v4 ETH/USDC").getByTestId("opp-verdict")).toHaveText("REJECT");
  await expect(row(page, "Put-like").getByTestId("opp-verdict")).toHaveText("REJECT");
  await expect(row(page, "Call-like").getByTestId("opp-verdict")).toHaveText("APPROVE");
});

test("2. each decision shows its verdict and reason, and the waterfall adds up", async ({ page }) => {
  await open(page);
  for (const label of ["Price gap · hooked", "Price gap · static", "Price gap · v4 ETH/USDC", "Put-like", "Call-like"]) {
    const d = await select(page, label);
    await expect(page.getByTestId("dec-verdict")).toHaveText(d.verdict);
    await expect(page.getByTestId("dec-reason")).toHaveText(d.reason);
    const v = async (k: string) => money(await page.locator(`[data-wf=${k}]`).textContent() ?? "");
    const [gross, gas, slippage, fees, hedge, risk, net] = await Promise.all(
      ["gross", "gas", "slippage", "fees", "hedge", "risk", "net"].map(v));
    // Costs render as negatives; hedge is the engine's fourth cost line (PRD 2).
    expect(Math.abs(gross + gas + slippage + fees + hedge + risk - net), `${label} waterfall`).toBeLessThanOrEqual(0.01);
  }
});

test("3. put-like curve: stress over budget, Approve disabled", async ({ page }) => {
  await open(page);
  const d = await select(page, "Put-like");
  const after = money(await page.getByTestId("stress-after").textContent() ?? "");
  expect(await page.getByTestId("stress-after").textContent()).toBe(usd(d.stress_loss_after));
  expect(after).toBeGreaterThan(Number(d.budget));
  await expect(page.getByTestId("approve")).toBeDisabled();
  await expect(page.getByTestId("approve")).toHaveText("Rejected: stress over budget");
  test.info().annotations.push({ type: "bug-list", description:
    `Spec expects stress after ≈ $971; engine reports ${usd(d.stress_loss_after)} (+${usd(Number(d.stress_loss_after) - Number(d.stress_loss_before))} from this trade). ` +
    "The $971 figure is from the $3,400 fixture; the demo is now on the fork's $2,218.55." });
});

test("4. call-like curve: Approve enabled, countdown runs to 0 and disables", async ({ page }) => {
  await open(page);
  await select(page, "Call-like");
  const btn = page.getByTestId("approve");
  await expect(btn).toBeEnabled();
  const secs = async () => Number((await btn.textContent())?.match(/· (\d+)s/)?.[1] ?? NaN);
  const first = await secs();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(30);
  await page.waitForTimeout(2_100);
  expect(await secs()).toBeLessThan(first);
  await expect(btn).toBeDisabled({ timeout: 35_000 });
  await expect(btn).toHaveText(/Expired/);
});

test("4b. swap through the hooked v4 pool: tx appears, Verify succeeds, fee paid = the hook's fee", async ({ page }) => {
  const snap = await rpc<string>("evm_snapshot"); // this sale would make the Aqua curve unfundable; undo it
  try {
    await open(page);
    const d = await select(page, "Price gap · hooked");
    await page.getByTestId("approve").click();
    await expect(page.locator("#log")).toContainText("verified · engine position", { timeout: 60_000 });
    const swap = page.getByTestId("v4-swap-tx").first();
    await expect(swap).toBeVisible({ timeout: 20_000 });
    // The fee actually paid is the hook's fee for the swap's block (it re-estimates per block).
    const h = hookDeployment();
    const fee = Number(BigInt(await rpc<string>("eth_call", [{ to: h.hook, data: "0xe5f3d3a5" + h.hooked_pool_id.slice(2) }, "latest"])));
    await expect(swap.getByTestId("fee-paid")).toContainText(`(${fee.toLocaleString("en-US")} pips)`);
    test.info().annotations.push({ type: "fee", description: `quoted ${Math.round(Number(d.inputs.request.market.fee_rate) * 1e6)} pips, paid ${fee} pips` });
    await swap.getByRole("button", { name: "Verify" }).click();
    await expect(swap.getByTestId("verify-result")).toContainText("success");
  } finally {
    await rpc("evm_revert", [snap]);
  }
});

test("5. ship and fill: tx hashes appear and Verify reads success receipts", async ({ page }) => {
  await open(page);
  await select(page, "Call-like");
  await page.getByTestId("approve").click();
  await expect(page.locator("#log")).toContainText("verified · engine position", { timeout: 60_000 });
  const ship = page.getByTestId("ship-tx").first();
  await expect(ship).toBeVisible();
  takerFill("upside");
  const fill = page.getByTestId("fill-tx").first();
  await expect(fill).toBeVisible({ timeout: 20_000 });
  for (const tx of [ship, fill]) {
    await tx.getByRole("button", { name: "Verify" }).click();
    await expect(tx.getByTestId("verify-result")).toContainText("success");
  }
});

test("5c. after the curve ships, the v4 sale is refused by the cross-primitive collateral check", async ({ page }) => {
  await open(page);
  await select(page, "Price gap · hooked");
  await page.getByTestId("approve").click();
  await expect(page.locator("#log")).toContainText("collateral check refused", { timeout: 20_000 });
});

test("6. replay a REJECT: same verdict, same numbers", async ({ page }) => {
  await open(page);
  const r = page.locator("[data-testid=history-row][data-verdict=REJECT]").first();
  const id = await r.getAttribute("data-decision");
  const d = await engineJson(`/decisions/${id}`);
  await r.getByRole("button", { name: "Replay" }).click();
  await expect(r.getByTestId("replay-result")).toHaveText(`identical · ${d.verdict} · net ${usd(d.net_edge)}`);
});

test("7. stop the engine: every panel shows Source unavailable within 5 s", async ({ page }) => {
  await open(page);
  await stopEngine();
  const t0 = Date.now();
  for (const id of ["opps", "decision", "aqua", "hook", "arc", "history"]) {
    await expect(page.locator(`#${id}`)).toContainText("Source unavailable: engine", { timeout: 5_000 - (Date.now() - t0) });
  }
  for (const id of ["opps", "decision", "aqua", "hook", "arc", "history"]) {
    expect(await page.locator(`#${id}`).textContent(), `no numbers left in #${id}`).not.toMatch(/\$\d/);
  }
  // Engine-sourced status cells drop their values too (WETH/USDC stay: live chain reads).
  await expect(page.locator("#status")).not.toContainText("Balanced");
  await startEngine();
});

test("8. number audit: five values match the engine and the chain exactly", async ({ page }) => {
  await open(page);
  const gap = await select(page, "Price gap · hooked");
  await expect(row(page, "Price gap · hooked").locator("td").nth(3)).toHaveText(usd(gap.gross_edge)); // engine gross_edge
  const call = await select(page, "Call-like");
  await expect(row(page, "Call-like").locator("td").nth(4)).toHaveText(usd(call.net_edge)); // engine net_edge
  await expect(page.getByTestId("aq-K_eq")).toHaveText(usd(call.inputs.aqua.k_eq)); // engine inputs.aqua.k_eq

  const maker = curves().maker as string;
  const bal = await rpc<string>("eth_call", [{ to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    data: "0x70a08231" + maker.slice(2).toLowerCase().padStart(64, "0") }, "latest"]);
  await expect(page.getByTestId("hold-WETH")).toHaveText(`${fixed(Number(BigInt(bal)) / 1e18, 4)} WETH`); // chain balanceOf

  const h = hookDeployment();
  const fee = await rpc<string>("eth_call", [{ to: h.hook, data: "0xe5f3d3a5" + h.hooked_pool_id.slice(2) }, "latest"]);
  await expect(page.getByTestId("hook-fee")).toContainText(`${Number(BigInt(fee)).toLocaleString("en-US")} pips`); // chain getFee
});
