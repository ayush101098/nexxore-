// Helpers for the e2e suite: the engine process, the demo chain's JSON-RPC, and raw engine reads.
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export async function startEngine(freshDb = false) {
  if (freshDb) rmSync(DB, { force: true });
  const py = process.env.RISKPILOT_PYTHON ?? join(ROOT, ".venv", "bin", "python");
  const child = spawn(py, ["-m", "uvicorn", "main:app", "--port", "8000"], {
    cwd: join(ROOT, "engine"), detached: true, stdio: "ignore",
    env: { ...process.env, RISKPILOT_DB: DB, DEMO_RPC_URL: RPC },
  });
  child.unref();
  writeState({ ...readState(), pid: child.pid });
  await waitFor(async () => (await fetch(ENGINE_URL + "/health")).ok, "the engine");
}

export async function stopEngine() {
  const { pid } = readState();
  if (pid) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } } }
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
