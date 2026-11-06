// Section 6 acceptance: one click through Arc, settled by the arc-worker, with no double settle.
// Needs the stack with the local Arc stand-in:
//   ARC_REHEARSAL=1 make demo-reset && cd web && ARC=1 E2E_EXTERNAL=1 npx playwright test arc
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installWallet, ROOT, engineJson } from "./stack";

test.skip(!process.env.ARC, "Arc rehearsal only: ARC=1 E2E_EXTERNAL=1");
const ARC_RPC = "http://127.0.0.1:8547";
const dep = () => JSON.parse(readFileSync(join(ROOT, "contracts", "arc", "deployments", "arc-rehearsal.json"), "utf8"));

async function arcRpc(method: string, params: unknown[]) {
  const r = await fetch(ARC_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}
const SETTLED = "0x" + execSync(`cast keccak "Settled(bytes32,address,uint256,uint256,uint256)"`).toString().trim().slice(2);
const settledLogs = (key: string) => arcRpc("eth_getLogs", [{ address: dep().escrow, topics: [SETTLED, key], fromBlock: "0x0", toBlock: "latest" }]);

test("one click: ship the call-like curve, fund on Arc, the worker settles; a restart never settles twice", async ({ page }) => {
  test.setTimeout(180_000);
  await installWallet(page); // the demo wallet, impersonated on the fork and on the Arc stand-in
  await page.goto(`/riskpilot?arcRpc=${ARC_RPC}`);
  const card = page.locator("[data-testid=profile-card][data-profile=moderate]");
  if (await card.isVisible().catch(() => false)) await card.click();
  await page.locator('[data-testid=opp-row][data-label^="Call-like"]').click();
  const id = (await page.getByTestId("decision").getAttribute("data-decision"))!;
  const btn = page.getByTestId("approve");
  await expect(btn).toHaveText(/^Approve and sign · \d+s$/);
  // Record every state the button passes through (local-key signing is instant, so observe, not poll).
  await page.evaluate(() => {
    const w = window as any; w.__steps = [];
    const btn = document.getElementById("approve")!;
    new MutationObserver(() => { const t = btn.textContent ?? ""; if (w.__steps.at(-1) !== t) w.__steps.push(t); })
      .observe(btn, { childList: true, characterData: true, subtree: true });
  });
  await btn.click();
  await expect(page.locator("#decision").getByTestId("settle-chip")).toHaveAttribute("data-status", "Settled", { timeout: 60_000 });
  const steps: string[] = await page.evaluate(() => (window as any).__steps);
  test.info().annotations.push({ type: "steps", description: steps.join(" → ") });
  console.log("steps:", steps.join(" → "));
  expect(steps.some((s) => /^Signing 1 of \d: /.test(s))).toBe(true);
  expect(steps.some((s) => /Switching to Arc/.test(s))).toBe(true);

  const key = execSync(`cast keccak "${id}"`).toString().trim();
  expect(await settledLogs(key)).toHaveLength(1);
  const [s] = await engineJson(`/v1/settlements?decision_id=${id}`);
  expect(s.status).toBe("Settled");

  // Restart the engine (and its worker) with the same DB: the catch-up replays Funded, reads
  // deposits() = Settled, and records nothing new on chain.
  execSync("ARC_REHEARSAL=1 ./scripts/stack.sh restart-engine >/dev/null", { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 6_000));
  expect(await settledLogs(key)).toHaveLength(1);
  const [again] = await engineJson(`/v1/settlements?decision_id=${id}`);
  expect(again.tx).toBe(s.tx);
});
