// make demo-reset restores the demo wallet's balances and the frozen decision ids.
//   cd web && RESET=1 E2E_EXTERNAL=1 npx playwright test reset
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_WALLET, ROOT, rpc } from "./stack";

test.skip(!process.env.RESET, "demo-reset check only: RESET=1 E2E_EXTERNAL=1");
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const balanceOf = async (token: string) =>
  BigInt(await rpc<string>("eth_call", [{ to: token, data: "0x70a08231" + DEMO_WALLET.slice(2).toLowerCase().padStart(64, "0") }, "latest"]));

test("after make demo-reset the demo wallet holds 992 ETH, 8 WETH, 5,000 USDC and the ids are the frozen ones", async () => {
  test.setTimeout(120_000);
  // Spend some of it first, so the reset has something to undo.
  await rpc("anvil_setBalance", [DEMO_WALLET, "0x1"]);
  const t = Date.now();
  execSync("make demo-reset", { cwd: ROOT, stdio: "ignore" });
  expect(Date.now() - t).toBeLessThan(30_000);
  expect(BigInt(await rpc<string>("eth_getBalance", [DEMO_WALLET, "latest"]))).toBe(992n * 10n ** 18n);
  expect(await balanceOf(WETH)).toBe(8n * 10n ** 18n); // covers the 7 WETH call-like curve
  expect(await balanceOf(USDC)).toBe(5_000n * 10n ** 6n);
  const seed = await (await fetch(`http://localhost:8000/v1/demo/seed?profile=moderate&wallet=${DEMO_WALLET}`, { method: "POST" })).json();
  const frozen = readFileSync(join(ROOT, "demo", "frozen", "ids.txt"), "utf8").trim().split("\n");
  expect(seed.items.map((i: any) => i.decision.decision_id)).toEqual(frozen);
  const put = seed.items.find((i: any) => i.label.startsWith("Put-like")).decision;
  expect(put.reason).toMatch(/^Rejected: adds \$629\.93 worst-case loss; limit \$250 \(/);
});
