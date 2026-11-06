// RiskPilot /riskpilot end-to-end suite (PRD 6). Runs against the live demo chain and engine.
import { expect, test, type Page } from "@playwright/test";
import { curves, DEMO_WALLET, engineJson, fixed, freshWallet, hookDeployment, installWallet, rpc, startEngine, stopEngine, takerFill, usd } from "./stack";

const row = (page: Page, label: string) => page.locator(`[data-testid=opp-row][data-label^="${label}"]`);
const money = (text: string) => Number(text.replace(/[$,\s]/g, "").replace("−", "-"));

// A failed outage test must not take the rest of the suite down with it.
test.afterEach(async () => {
  const up = await fetch("http://localhost:8000/v1/health").then((r) => r.ok, () => false);
  if (!up) await startEngine();
});

const ROWS = 5; // three live v4 gaps + the two Aqua curves
// The demo wallet (the owner's address) through the injected test wallet; its Moderate profile
// comes with the frozen demo DB, so no signature is needed to open the page.
async function open(page: Page) {
  await installWallet(page, DEMO_WALLET);
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS);
}

// A fresh wallet (a new random key, dealt the demo wallet's balances): it chooses and signs its profile.
async function openFresh(page: Page) {
  const w = freshWallet();
  await installWallet(page, w.address, w.key);
  await page.goto("/riskpilot");
  return w;
}

test("0. fresh wallet: three profile cards, none preselected; Moderate gives budget $250 (cap)", async ({ page }) => {
  await openFresh(page);
  const cards = page.getByTestId("profile-card");
  await expect(cards).toHaveCount(3);
  await expect(cards).toHaveText([/Conservative/, /Moderate/, /Aggressive/]);
  await expect(page.locator("[data-testid=profile-card][aria-pressed=true]")).toHaveCount(0);
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(0); // no decisions before a profile
  await page.locator("[data-testid=profile-card][data-profile=moderate]").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Moderate · budget $250 (cap)");
  await expect(page.getByTestId("profile-status")).toHaveAttribute("data-tip", /min\(2\.5% x wallet value, \$250\)/);
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS);
});

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
  await expect(page.getByTestId("approve")).toHaveText("Rejected: adds $629.93 worst-case loss, limit $250");
  test.info().annotations.push({ type: "bug-list", description:
    `Spec expects stress after ≈ $971; engine reports ${usd(d.stress_loss_after)} (+${usd(Number(d.stress_loss_after) - Number(d.stress_loss_before))} from this trade). ` +
    "The $971 figure is from the $3,400 fixture; the demo is now on the fork's $2,218.55." });
});

test("4. call-like curve: Approve enabled, counts down, requotes in place keeping the selection", async ({ page }) => {
  await open(page);
  await select(page, "Call-like");
  const btn = page.getByTestId("approve");
  await expect(btn).toBeEnabled();
  const secs = async () => Number((await btn.textContent())?.match(/· (\d+)s/)?.[1] ?? NaN);
  const first = await secs();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(30);
  // It counts down: some reading is lower than the one 1.2 s before it (a requote landing in
  // between restarts it, so compare consecutive readings rather than the first one).
  let prev = first, later = NaN;
  for (let i = 0; i < 8 && Number.isNaN(later); i++) {
    await page.waitForTimeout(1_200);
    const now = await secs();
    if (now < prev) later = now; else prev = now;
  }
  expect(later, "countdown decreased").toBeGreaterThan(0);
  // Requote in place: before it runs out the engine re-issues the decision; the selection stays.
  await expect.poll(secs, { timeout: 20_000 }).toBeGreaterThan(later);
  await expect(page.getByTestId("decision")).toHaveAttribute("data-key", /aqua_premium:.*call_like/);
  await expect(btn).toBeEnabled();
});

test("4b. swap through the hooked v4 pool: tx appears, receipt verified, fee paid = the hook's fee", async ({ page }) => {
  const snap = await rpc<string>("evm_snapshot"); // this sale would make the Aqua curve unfundable; undo it
  try {
    await open(page);
    const d = await select(page, "Price gap · hooked");
    await page.getByTestId("approve").click();
    await expect(page.locator("#log")).toContainText("verified ·", { timeout: 60_000 });
    await expect(page.getByTestId("confirmed")).toHaveText("Confirmed · view tx");
    const swap = page.getByTestId("v4-swap-tx").first();
    await expect(swap).toBeVisible({ timeout: 20_000 });
    // The fee actually paid is the hook's fee for the swap's block (it re-estimates per block).
    const h = hookDeployment();
    const fee = Number(BigInt(await rpc<string>("eth_call", [{ to: h.hook, data: "0xe5f3d3a5" + h.hooked_pool_id.slice(2) }, "latest"])));
    await expect(swap.getByTestId("fee-paid")).toHaveAttribute("data-pips", String(fee));
    await expect(swap).toContainText(/Quoted \d\.\d\d% · paid \d\.\d\d%/);
    test.info().annotations.push({ type: "fee", description: `quoted ${Math.round(Number(d.inputs.request.market.fee_rate) * 1e6)} pips, paid ${fee} pips` });
    await expect(swap.getByTestId("verify-result")).toContainText("success"); // read from the receipt, no button
  } finally {
    await rpc("evm_revert", [snap]);
  }
});

test("5. one click ships the curve; ship and fill receipts verified automatically", async ({ page }) => {
  await open(page);
  await select(page, "Call-like");
  await page.getByTestId("approve").click();
  await expect(page.locator("#log")).toContainText("verified ·", { timeout: 60_000 });
  const ship = page.getByTestId("ship-tx").first();
  await expect(ship).toBeVisible();
  takerFill("upside");
  const fill = page.getByTestId("fill-tx").first();
  await expect(fill).toBeVisible({ timeout: 20_000 });
  for (const tx of [ship, fill]) await expect(tx.getByTestId("verify-result")).toContainText("success");
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

test("7. kill the engine: every panel shows Source unavailable within 5 s", async ({ page }) => {
  await open(page);
  const t0 = Date.now();
  await stopEngine("SIGKILL"); // a real kill, not a mocked fetch
  for (const id of ["opps", "decision", "aqua", "hook", "arc", "history"]) {
    await expect(page.locator(`#${id}`)).toContainText("Source unavailable: engine", { timeout: 5_000 - (Date.now() - t0) });
  }
  for (const id of ["opps", "decision", "aqua", "hook", "arc", "history"]) {
    expect(await page.locator(`#${id}`).textContent(), `no numbers left in #${id}`).not.toMatch(/\$\d/);
  }
  // Engine-sourced status cells drop their values too (WETH/USDC stay: live chain reads).
  await expect(page.locator("#status")).not.toContainText("Moderate");
  test.info().annotations.push({ type: "latency", description: `engine down to Source unavailable on every panel: ${Date.now() - t0} ms` });
  await startEngine();
  // Recovery: the stream reconnects and the page re-renders without a reload.
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS, { timeout: 15_000 });
});

test("8. number audit: five values match the engine and the chain exactly", async ({ page }) => {
  await open(page);
  const gap = await select(page, "Price gap · hooked");
  await expect(row(page, "Price gap · hooked").locator("td").nth(3)).toHaveText(usd(gap.gross_edge)); // engine gross_edge
  const call = await select(page, "Call-like");
  await expect(row(page, "Call-like").locator("td").nth(4)).toHaveText(usd(call.net_edge)); // engine net_edge
  await expect(page.getByTestId("aq-K_eq")).toHaveText(usd(call.inputs.aqua.k_eq)); // engine inputs.aqua.k_eq

  const maker = curves().maker as string;
  expect(maker).toBe(DEMO_WALLET); // the demo wallet is the owner's address
  const bal = await rpc<string>("eth_call", [{ to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    data: "0x70a08231" + maker.slice(2).toLowerCase().padStart(64, "0") }, "latest"]);
  await expect(page.getByTestId("hold-WETH")).toHaveText(`${fixed(Number(BigInt(bal)) / 1e18, 4)} WETH`); // chain balanceOf

  const h = hookDeployment();
  const fee = await rpc<string>("eth_call", [{ to: h.hook, data: "0xe5f3d3a5" + h.hooked_pool_id.slice(2) }, "latest"]);
  await expect(page.getByTestId("hook-fee")).toContainText(`${Number(BigInt(fee)).toLocaleString("en-US")} pips`); // chain getFee
});

test("9. the only trade control is Approve and sign", async ({ page }) => {
  await open(page);
  for (const label of ["Price gap · hooked", "Put-like", "Call-like"]) {
    await select(page, label);
    const names = await page.locator("main button").evaluateAll((bs) => bs.map((b) => b.textContent?.trim() ?? ""));
    const trade = names.filter((n) => !/^(Copy|Replay|View API|Change|\?)$/.test(n));
    expect(trade, label).toHaveLength(1);
    expect(trade[0]).toMatch(/^(Approve and sign|Rejected:|Already shipped|Requoting)/);
    for (const gone of ["Re-evaluate", "Ship", "Verify", "Fund"]) expect(names.some((n) => n.startsWith(gone)), gone).toBe(false);
  }
});

test("10. a new block requotes in place: new decision id, same selection", async ({ page }) => {
  await open(page);
  await select(page, "Price gap · static");
  const dec = page.getByTestId("decision");
  const [id, key] = [await dec.getAttribute("data-decision"), await dec.getAttribute("data-key")];
  const t = Date.now();
  await rpc("evm_mine");
  await expect(dec).not.toHaveAttribute("data-decision", id!, { timeout: 5_000 });
  test.info().annotations.push({ type: "latency", description: `block to verdict on screen ${Date.now() - t} ms (incl. RPC)` });
  await expect(dec).toHaveAttribute("data-key", key!);
});

test("11. Conservative: budget $150 (cap); change re-evaluates everything", async ({ page }) => {
  await openFresh(page);
  await page.locator("[data-testid=profile-card][data-profile=moderate]").click();
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS);
  await page.getByTestId("profile-change").click();
  await page.locator("[data-testid=profile-card][data-profile=conservative]").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Conservative · budget $150 (cap)");
  const d = await select(page, "Put-like");
  await expect(page.getByTestId("budget")).toHaveText("$150.00");
  expect(d.inputs.profile.name).toBe("conservative");
  // Conservative's 50% Aqua fee margin lifts the premium floor above the curve's fee (rule 3b),
  // so the curve is rejected before the stress rule is reached.
  expect(d.reason).toMatch(/^Rejected: curve fee 0\.227% below premium floor/);
  await expect(page.getByTestId("approve")).toHaveText(d.reason.split(" (")[0]);
  await page.getByTestId("profile-change").click();
  await page.locator("[data-testid=profile-card][data-profile=moderate]").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Moderate · budget $250 (cap)");
});

test("12. demo pools are tagged as seeded on the fork", async ({ page }) => {
  await open(page);
  await expect(row(page, "Price gap · hooked").getByTestId("demo-tag")).toHaveText("Demo pool · seeded on fork");
  await expect(row(page, "Price gap · static").getByTestId("demo-tag")).toHaveText("Demo pool · seeded on fork");
  await expect(row(page, "Price gap · v4 ETH/USDC").getByTestId("demo-tag")).toHaveCount(0);
});

test("13. read-only page: no wallet requests, nothing signable", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = ((window as any).__walletCalls = []);
    (window as any).ethereum = { request: async ({ method }: { method: string }) => { calls.push(method); throw new Error("no"); }, on() {} };
  });
  await page.goto("/riskpilot?readonly=1");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(ROWS); // the wallet already chose a profile
  await expect(page.getByTestId("profile-card")).toHaveCount(0);
  await select(page, "Call-like");
  await expect(page.getByTestId("approve")).toBeDisabled();
  await expect(page.getByTestId("approve")).toHaveText("Read-only page: run make up to sign");
  expect(await page.evaluate(() => (window as any).__walletCalls)).toEqual([]);
});
