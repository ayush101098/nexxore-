// Helpers for the e2e suite: the engine process, the demo chain's JSON-RPC, and raw engine reads.
import { spawn, execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(__dirname, "..", "..");
export const ENGINE_URL = "http://localhost:8000";
export const RPC = process.env.DEMO_RPC_URL ?? "http://127.0.0.1:8545";
const STATE = join(tmpdir(), "riskpilot-e2e.json");
const DB = join(tmpdir(), "riskpilot-e2e.db");

type State = { pid?: number; snapshot?: string };
export const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const writeState = (s: State) => writeFileSync(STATE, JSON.stringify(s));

export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

export async function engineJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(ENGINE_URL + path, init);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// freshDb: start from the frozen demo DB (demo/frozen/riskpilot.db: the demo wallet on Moderate,
// recorded by make demo-freeze), or an empty one if nothing is frozen.
export async function startEngine(freshDb = false) {
  if (freshDb) {
    for (const f of [DB, DB + "-wal", DB + "-shm"]) rmSync(f, { force: true });
    const frozen = join(ROOT, "demo", "frozen", "riskpilot.db");
    if (existsSync(frozen)) copyFileSync(frozen, DB);
  }
  const py = process.env.RISKPILOT_PYTHON ?? join(ROOT, ".venv", "bin", "python");
  const child = spawn(py, ["-m", "uvicorn", "main:app", "--port", "8000", "--timeout-graceful-shutdown", "1"], {
    cwd: join(ROOT, "engine"), detached: true, stdio: "ignore",
    env: { ...process.env, RISKPILOT_DB: DB, DEMO_RPC_URL: RPC },
  });
  child.unref();
  writeState({ ...readState(), pid: child.pid });
  await waitFor(async () => (await fetch(ENGINE_URL + "/health")).ok, "the engine");
}

/** signal "SIGKILL" is the outage test's hard kill: no shutdown, connections just drop. */
export async function stopEngine(signal: NodeJS.Signals = "SIGTERM") {
  const { pid } = readState();
  if (pid) { try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } } }
  writeState({ ...readState(), pid: undefined });
  await waitFor(async () => !(await fetch(ENGINE_URL + "/health").then(() => true, () => false)), "the engine to stop", 10_000);
}

export async function snapshotChain() {
  writeState({ ...readState(), snapshot: await rpc<string>("evm_snapshot") });
}

export async function revertChain() {
  const { snapshot } = readState();
  if (snapshot) await rpc("evm_revert", [snapshot]);
}

/** Scripted taker on the demo chain (contracts/aqua make demo-fill). */
export function takerFill(curve: "upside" | "downside") {
  execSync(`make demo-fill CURVE=${curve}`, { cwd: join(ROOT, "contracts", "aqua"), stdio: "ignore",
    env: { ...process.env, DEMO_PORT: new URL(RPC).port } });
}

export const curves = () => JSON.parse(readFileSync(join(ROOT, "contracts", "aqua", "demo", "curves.json"), "utf8"));
export const hookDeployment = () => JSON.parse(readFileSync(join(ROOT, "contracts", "hook", "demo", "hook.json"), "utf8"));

// Formatting the page uses, so UI text can be compared with raw values exactly.
export const usd = (v: number | string) => {
  const n = Number(v);
  return (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const fixed = (v: number | string, d: number) =>
  Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// ── test wallet ───────────────────────────────────────────────────────────────
// An injected EIP-1193 wallet for the page, like a browser extension. It acts as `address` on the
// local chains through Anvil impersonation (no key needed to send), and signs messages only when
// the test gives it a key (a freshly generated one; never an Anvil default account).
import type { Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { execSync as exec } from "node:child_process";

export const DEMO_WALLET = "0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697";
const CHAIN_RPC: Record<number, string> = { 31337: RPC, 5042002: "http://127.0.0.1:8547" };

export async function rpcAt<T = any>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j.result;
}

/** sendError: make every eth_sendTransaction fail with this message (e.g. MetaMask's stale-nonce text).
 *  firstSendDelayMs: wait this long before the first send, like a person reading a wallet prompt. */
export async function installWallet(page: Page, address: string = DEMO_WALLET, privateKey?: `0x${string}`,
  opts: { sendError?: string; firstSendDelayMs?: number; approveDivisor?: bigint } = {}) {
  let sends = 0;
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  await page.exposeFunction("__rpWallet", async (method: string, params: any[], chainId: number) => {
    const url = CHAIN_RPC[chainId];
    switch (method) {
      case "eth_requestAccounts": case "eth_accounts": return [address];
      case "wallet_getCapabilities": return {};
      case "personal_sign":
        if (!account) throw Object.assign(new Error("this test wallet holds no key: it cannot sign messages"), { code: 4100 });
        return account.signMessage({ message: { raw: params[0] } });
      case "eth_sendTransaction":
        if (opts.sendError) throw Object.assign(new Error(opts.sendError), { code: -32603 });
        if (sends++ === 0 && opts.firstSendDelayMs) await new Promise((r) => setTimeout(r, opts.firstSendDelayMs));
        // approveDivisor: like a user editing the spending cap in the wallet, approve less than asked.
        if (opts.approveDivisor && String(params[0]?.data ?? params[0]?.input ?? "").startsWith("0x095ea7b3")) {
          const tx = { ...params[0] }, data = String(tx.data ?? tx.input);
          const amount = BigInt("0x" + data.slice(74, 138)) / opts.approveDivisor;
          tx.data = data.slice(0, 74) + amount.toString(16).padStart(64, "0"); delete tx.input;
          params = [tx, ...params.slice(1)];
        }
        await rpcAt(url, "anvil_impersonateAccount", [address]);
        return rpcAt(url, "eth_sendTransaction", params);
      default: return rpcAt(url, method, params);
    }
  });
  await page.addInitScript(() => {
    let chainId = 31337;
    const known = [31337, 5042002];
    (window as any).ethereum = {
      isRiskPilotTestWallet: true,
      on() {}, removeListener() {},
      async request({ method, params = [] }: { method: string; params?: any[] }) {
        if (method === "eth_chainId") return "0x" + chainId.toString(16);
        if (method === "wallet_switchEthereumChain") {
          const id = parseInt(params[0].chainId, 16);
          if (!known.includes(id)) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
          chainId = id; return null;
        }
        if (method === "wallet_addEthereumChain") { chainId = parseInt(params[0].chainId, 16); return null; }
        try { return await (window as any).__rpWallet(method, params, chainId); }
        catch (e: any) { throw Object.assign(new Error(e.message), { code: /no key/.test(e.message) ? 4100 : -32603 }); }
      },
    };
  });
}

/** A fresh wallet (new random key), given the demo wallet's balances on the fork. */
export function freshWallet(): { address: string; key: `0x${string}` } {
  const key = generatePrivateKey(), address = privateKeyToAccount(key).address;
  exec(`./scripts/deal.sh ${address} 992 8 5000 ${RPC}`, { cwd: ROOT, stdio: "ignore" });
  return { address, key };
}

const word = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
/** ERC-20 allowance(owner, spender) on a chain (default: the demo fork). */
export async function allowance(token: string, owner: string, spender: string, url: string = RPC): Promise<bigint> {
  return BigInt(await rpcAt<string>(url, "eth_call", [{ to: token, data: "0xdd62ed3e" + word(owner) + word(spender) }, "latest"]));
}
