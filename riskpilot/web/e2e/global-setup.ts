import { rpc, snapshotChain, startEngine, stopEngine } from "./stack";

export default async function globalSetup() {
  const chainId = await rpc<string>("eth_chainId").catch(() => {
    throw new Error("demo chain not running on :8545: run `make demo-chain` (contracts/aqua) and `make hook-pool` (contracts/hook)");
  });
  if (parseInt(chainId, 16) !== 31337) throw new Error(`unexpected chain id ${chainId}`);
  await snapshotChain();
  // E2E_EXTERNAL=1: use the stack `make up` started (e.g. ARC_REHEARSAL=1 make demo-reset).
  if (process.env.E2E_EXTERNAL) return;
  await stopEngine().catch(() => {});
  await startEngine(true);
}
