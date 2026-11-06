import { rpc, snapshotChain, startEngine, stopEngine } from "./stack";
import { startFake0G } from "./fake0g";

export default async function globalSetup() {
  const chainId = await rpc<string>("eth_chainId").catch(() => {
    throw new Error("demo chain not running on :8545: run `make demo-chain` (contracts/aqua) and `make hook-pool` (contracts/hook)");
  });
  if (parseInt(chainId, 16) !== 31337) throw new Error(`unexpected chain id ${chainId}`);
  await snapshotChain();
  // A stand-in for 0G Private Computer (OpenAI-compatible, x_0g_trace.request_id) for the assistant.
  await startFake0G();
  process.env.ZG_BASE_URL = "http://127.0.0.1:8788/v1";
  process.env.ZG_API_KEY = "test-key-not-a-real-0g-key";
  // E2E_EXTERNAL=1: use the stack `make up` started (e.g. ARC_REHEARSAL=1 make demo-reset).
  if (process.env.E2E_EXTERNAL) return;
  await stopEngine().catch(() => {});
  await startEngine(true);
}
