# @riskpilot/sdk

A small client for the RiskPilot engine's v1 API (`../docs/openapi.yaml`). The engine decides;
your wallet signs every transaction. The SDK never holds a key.

```ts
import { RiskPilot } from "@riskpilot/sdk";

const rp = new RiskPilot({ engine: "http://localhost:8000", account });   // a viem Account
await rp.setProfile("moderate");             // once per wallet, EIP-191 signed
const stop = rp.subscribe((e) => {           // block, opportunity, decision, health, settlement
  if (e.event === "opportunity") console.log(e.data.items.map((i) => i.decision.verdict));
});
const d = await rp.evaluate({ opportunity });         // any opportunity, under the wallet's profile
await rp.verifyDecision(d, engineSigner);             // EIP-712 RiskPilotDecision, signer from /v1/health
const plan = await rp.build(d.decision_id);           // EIP-5792 calls[]; 409 unless a live, signed APPROVE
const hash = await rp.execute(plan, { wallet, publicClient });   // simulate, then send each call in order
await rp.report({ decision_id: d.decision_id, chain_id: plan.chain_id, tx_hash: hash,
  status: "confirmed", verified_at: new Date().toISOString(), settlement_tx: null });
```

`plan.calls` can also go to a wallet as one `wallet_sendCalls` (EIP-5792) batch.

## Example agent

`examples/agent.ts` sets a profile, subscribes, picks the approved price gap with the largest net
edge, checks the engine's signature, then builds, executes and reports it.

```bash
make demo-reset                                   # repo root
cd sdk && npm install
AGENT_KEY=0x… npm run agent                       # the agent wallet's key, from your terminal
```

A run on the demo chain (Anvil #0 public test key):

```
engine engine-0.1.0 · signer 0x2E9c…fD5F · stream websocket newHeads
block 26354383: 5 opportunities, budget 250.00 (cap)
  APPROVE Price gap · hooked v4 pool · net 15.38
  APPROVE Price gap · static 0.30% v4 pool · net 7.19
  REJECT  Price gap · v4 ETH/USDC 0.30% · net -15.80
  REJECT  Put-like curve · 1,740–2,219 · net -314.41
  APPROVE Call-like curve · 2,219–2,829 · net 5.71
executing Price gap · hooked v4 pool · dec_26722bb95a2f0654 (signature verified)
plan: approve for the v4 router → swap through the v4 pool
confirmed 0xfeb1…0641 in block 26354385 · position pos_26722bb95a2f0654 open
```
