// An agent that plugs into RiskPilot: choose a profile, listen, execute the best approved gap.
//
//   make demo-reset                     # repo root: demo chain + engine
//   cd sdk && npm install && AGENT_KEY=0x… npm run agent
//
// AGENT_KEY is the agent wallet's key, from your terminal. On the demo chain the Anvil #0 public
// test key works (it is the demo maker). The engine decides; this wallet signs every transaction.
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { RiskPilot, RiskPilotError, type Opportunities } from "../src/index.ts";

const ENGINE = process.env.RISKPILOT_ENGINE ?? "http://localhost:8000";
const RPC = process.env.DEMO_RPC_URL ?? "http://127.0.0.1:8545";
const key = process.env.AGENT_KEY as Hex | undefined;
if (!key) throw new Error("set AGENT_KEY (the agent wallet's private key) in your terminal");

const account = privateKeyToAccount(key);
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const rp = new RiskPilot({ engine: ENGINE, account });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const health = await (await fetch(`${ENGINE}/v1/health`)).json();
log(`engine ${health.model_version} · signer ${health.engine_signer} · stream ${health.dependencies.chain.stream}`);
if ((await rp.profile()) == null) log("profile set:", (await rp.setProfile("moderate")).profile);

let done = false;
const stop = rp.subscribe(async (e) => {
  if (e.event === "block") log(`block ${e.data.block}`);
  if (e.event !== "opportunity" || done) return;
  done = true;
  try { await act(e.data); } catch (err) { log("stopped:", err instanceof RiskPilotError ? err.message : err); }
  stop();
}, (err) => log("stream error:", err));

async function act(o: Opportunities) {
  log(`block ${o.block}: ${o.items.length} opportunities, budget ${o.profile.budget} (${o.profile.budget_bound})`);
  for (const it of o.items) log(`  ${it.decision.verdict.padEnd(7)} ${it.label} · net ${it.decision.net_edge}`);
  // The agent's own choice: the approved price gap with the largest net edge.
  const best = o.items.filter((i) => i.decision.verdict === "APPROVE" && i.opportunity.type === "price_gap")
    .sort((a, b) => Number(b.decision.net_edge) - Number(a.decision.net_edge))[0];
  if (!best) return log("nothing approved to execute");
  const d = best.decision;
  if (!(await rp.verifyDecision(d, health.engine_signer))) throw new Error(`${d.decision_id} is not signed by the engine`);
  log(`executing ${best.label} · ${d.decision_id} (signature verified)`);
  const plan = await rp.build(d.decision_id);
  log(`plan: ${plan.calls.map((c) => c.label).join(" → ")}`);
  const hash = await rp.execute(plan, { wallet, publicClient });
  const rc = await publicClient.getTransactionReceipt({ hash });
  const position = await rp.report({ decision_id: d.decision_id, chain_id: plan.chain_id, tx_hash: hash,
    status: rc.status === "success" ? "confirmed" : "reverted", verified_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), settlement_tx: null });
  log(`confirmed ${hash} in block ${rc.blockNumber} · position ${position.position_id} ${position.status}`);
}
