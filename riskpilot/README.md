# RiskPilot: pricing liquidity risk

Risk-aware execution engine for programmable liquidity. Prices LP positions as options, stress-tests
them against your wallet, and executes only what you sign.

The pair is ETH/USDC. The demo runs on Ethereum: a local fork of mainnet at block 26,354,292, with
the real Uniswap v4 PoolManager, 1inch Aqua and SwapVM, WETH and USDC.

## What it does

1. **Scan.** The scanner reads every Uniswap v4 ETH/USDC pool on the fork (StateView prices,
   V4Quoter quotes at size), plus two Aqua curves the demo wallet can ship. There are five
   opportunities per block.
2. **Quantify.**
   - Net edge = gross − gas − slippage − fees − hedge − λ × added stress loss.
   - Stress is the wallet's worst loss over 14 spot/vol scenarios, before and after the trade.
   - Aqua curves are priced as their equivalent option: strike K_eq, term T_eq and Black-Scholes
     value C_eq.
3. **Decide.** Each opportunity gets APPROVE, REJECT, REQUOTE or REQUIRE_REVIEW, with a one-line
   reason. At the frozen demo block, under Moderate:

   | Opportunity | Verdict | Net edge | Reason |
   |---|---|---|---|
   | Price gap · hooked v4 pool | APPROVE | $15.38 | clears the $5.00 hurdle |
   | Price gap · static 0.30% v4 pool | APPROVE | $7.19 | clears the $5.00 hurdle |
   | Price gap · v4 ETH/USDC 0.30% | REJECT | −$15.80 | net edge below the $5.00 hurdle |
   | Put-like Aqua curve · 1,740–2,219 | REJECT | −$314.41 | adds $629.93 worst-case loss; limit $250 |
   | Call-like Aqua curve · 2,219–2,829 (7 WETH) | APPROVE | $5.71 | clears the hurdle; lowers the worst loss |

4. **Execute.** One click on Approve and sign runs every transaction the decision needs, as a
   stepper or an EIP-5792 batch:
   - exact-amount approvals;
   - the swap or the curve ship;
   - each one validated and simulated again right before it is sent.

   Your wallet signs. The engine holds no user key.
5. **Settle.** An approved decision can be funded in a USDC escrow on Arc, keyed by `decision_id`.
   The arc-worker then settles it after the trade is verified. Arc is built and tested, but it is
   off by default: the demo is Ethereum only, and Arc is enabled once `deployments/arc-testnet.json`
   exists.

## Architecture

```
                     browser wallet (your address signs)
                                  │
  ┌───────────────────────────────▼───────────────────────────────┐
  │ web: /riskpilot page + adapters.js (aqua, v4, arc)            │
  │   profile cards · decision · Approve and sign stepper         │
  └───────────▲──────────────────────────────────┬────────────────┘
       SSE /v1/stream                    POST /v1/executions
  ┌───────────┴──────────────────────────────────▼────────────────┐
  │ engine (FastAPI, :8000)                                       │
  │   BlockWatcher ── newHeads (WS) / 2 s poll                    │
  │   scanner ── StateView, V4Quoter, hook.getFee/σ, Aqua         │
  │   decision ── net edge · stress grid · verdict · EIP-712 sig  │
  │   store (SQLite WAL) ── decisions, positions, executions,     │
  │                         profiles, settlements                 │
  │   arc-worker ── Funded logs → verify → settle()               │
  └───────┬──────────────────────────────────────────────┬────────┘
          │ JSON-RPC                                     │ JSON-RPC
  ┌───────▼───────────────────────────┐   ┌──────────────▼────────┐
  │ anvil: Ethereum mainnet fork      │   │ Arc testnet (5042002) │
  │   Uniswap v4 PoolManager          │   │   RiskPilotEscrow     │
  │   VolatilityFeeHook + 2 pools     │   │   USDC 0x3600…0000    │
  │   1inch Aqua + SwapVM router      │   └───────────────────────┘
  └───────────────────────────────────┘
```

| Part | Runs as | Started by |
|---|---|---|
| anvil | `anvil --fork-url … --chain-id 31337`, :8545 | `make up` (`scripts/stack.sh`) |
| engine | `uvicorn main:app`, :8000; also serves the page | `make up` |
| arc-worker | a thread in the engine process; starts only when an Arc deployment file exists | the engine |
| web | static `web/index.html` + `web/adapters.js`, served by the engine; nexxore.xyz/riskpilot serves the same page read-only | the engine / Vercel |

Every module reads and writes the JSON Schemas in `shared/schemas/` (Opportunity, Decision,
Position, Execution).

## Run it

**Prerequisites:**
- Foundry (`anvil`, `forge`, `cast`);
- Python 3.12;
- Node 20 and Google Chrome (for the e2e tests);
- an Ethereum mainnet archive RPC URL.

```bash
python3 -m venv .venv && .venv/bin/pip install -r shared/requirements.txt -r engine/requirements.txt
cp .env.example .env              # set AQUA_FORK_RPC_URL
make up                           # fork + engine; the first run builds the chain and freezes it (~2 min)
open http://localhost:8000/riskpilot
make demo-reset                   # back to the frozen block, same decision ids, ~3 s
make hook-volatile                # a volatile spell through the hooked pool: fee 2,161 -> 8,976 pips
make preflight                    # PASS/FAIL checks before a demo
make down
```

**The demo wallet is `0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697`** (`scripts/addresses.sh`).
- **Balances:** on the fork it holds 992 ETH, 8 WETH and 5,000 USDC, set by `scripts/deal.sh`
  (balance and storage writes).
- **Signing:** connect a browser wallet to chain 31337 at `http://127.0.0.1:8545`.
- **No Anvil default account is used anywhere.** The taker and the hook LP are addresses with no
  known key, and they act through Anvil impersonation.

| Suite | Command | Tests |
|---|---|---|
| Engine | `cd engine && ../.venv/bin/python -m pytest -q` | 91 |
| Schemas | `cd shared && ../.venv/bin/python -m pytest -q` | 19 |
| e2e (Playwright, needs `make up`) | `cd web && npm ci && npx playwright test riskpilot` | 16 |
| Reset check | `make demo-reset && cd web && RESET=1 E2E_EXTERNAL=1 npx playwright test reset` | 1 |
| Arc e2e (local Arc stand-in) | `ARC_REHEARSAL=1 make demo-reset && cd web && ARC=1 E2E_EXTERNAL=1 npx playwright test arc` | 1 |
| Foundry: Aqua (fork) | `cd contracts/aqua && make test` | 12 |
| Foundry: v4 hook | `cd contracts/hook && make test` | 6 |
| Foundry: Arc escrow | `cd contracts/arc && make test` | 7 |
| Outage (real engine kill, headed) | `make outage-test` | 1 |

## Integrate

The API is under `/v1`; the unversioned paths are aliases. The spec is `docs/openapi.yaml`
(`make openapi`), also served at `/v1/openapi.json`.

| Method and path | Does |
|---|---|
| `PUT /v1/profile` | Set the wallet's profile (Conservative, Moderate or Aggressive); EIP-191 signed |
| `GET /v1/profile?wallet=` | The wallet's profile and how it was set |
| `GET /v1/profiles` | The three profiles and every fixed parameter |
| `GET /v1/stream?wallet=` | Server-sent events: `block`, `opportunity`, `decision`, `health`, `settlement`; 15 s heartbeat |
| `GET /v1/opportunities?wallet=` | The wallet's evaluated opportunities at the current block |
| `POST /v1/evaluate` | Evaluate any opportunity; with `wallet`, under its profile and this block's derived limits |
| `GET /v1/decisions`, `GET /v1/decisions/{id}` | Stored decisions, each with an EIP-712 signature |
| `POST /v1/decisions/{id}/build` | EIP-5792 `calls[]` for a live, signed APPROVE; 409 otherwise |
| `POST /v1/decisions/{id}/replay` | Re-run from recorded inputs; must be identical |
| `POST /v1/executions`, `GET /v1/executions` | Report a verified execution (idempotent); list them |
| `GET /v1/positions` | Open positions |
| `GET /v1/settlements` | Arc settlement status per decision |
| `GET`/`POST /v1/decisions/{id}/settlement` | Payout for an escrowed amount; record a settle tx |
| `POST /v1/scan`, `POST /v1/stress`, `POST /v1/aqua/price` | Scanner, stress grid and Aqua curve pricing as standalone calls |
| `GET /v1/health`, `GET /v1/metrics` | Dependencies and warnings; p50/p95 per route |
| `POST /v1/demo/seed`, `GET /v1/demo/info` | The demo's five opportunities; demo deployment info |

**Signatures.** A decision is signed as EIP-712 `RiskPilotDecision{id, wallet, inputsHash,
verdict, expiresAt}` with `RISKPILOT_ENGINE_KEY`. `decision_id` = hash(inputs, block, engine
version).

**SDK** (`sdk/`, `@riskpilot/sdk`):

```ts
import { RiskPilot } from "@riskpilot/sdk";

const rp = new RiskPilot({ engine: "http://localhost:8000", account });  // a viem Account
await rp.setProfile("moderate");
rp.subscribe((e) => { if (e.event === "opportunity") console.log(e.data.items.length); });
const d = await rp.evaluate({ opportunity });
await rp.verifyDecision(d, engineSigner);           // the signer from /v1/health
const plan = await rp.build(d.decision_id);         // EIP-5792 calls[]
const hash = await rp.execute(plan, { wallet, publicClient });  // simulate, then send each call
await rp.report({ decision_id: d.decision_id, chain_id: plan.chain_id, tx_hash: hash,
  status: "confirmed", verified_at: new Date().toISOString(), settlement_tx: null });
```

**`sdk/examples/agent.ts`** sets a profile, subscribes, picks the approved price gap with the
largest net edge, checks the engine's signature, then builds, executes and reports. Real output
from a freshly generated wallet funded with `scripts/deal.sh <address> 20 8 5000`:

```
engine engine-0.1.0 · signer 0x6D28Cc18e1089F501913d0d437f11f502173c184 · stream websocket newHeads
profile set: moderate
block 26354377: 5 opportunities, budget 250.00 (cap)
  APPROVE Price gap · hooked v4 pool · net 15.38
  APPROVE Price gap · static 0.30% v4 pool · net 7.19
  REJECT  Price gap · v4 ETH/USDC 0.30% · net -15.80
  REJECT  Put-like curve · 1,740–2,219 · net -314.41
  APPROVE Call-like curve · 2,219–2,829 · net 5.71
executing Price gap · hooked v4 pool · dec_af8d78aa943cacd7 (signature verified)
plan: approve for the v4 router → swap through the v4 pool
block 26354378
confirmed 0x8f300cc3fd0da6f9dd23bfa91ff66fb21604205ad8afe041a825daa49507c16a in block 26354379 · position pos_af8d78aa943cacd7 open
```

## Partner integrations

| Partner | What | Files | What proves it |
|---|---|---|---|
| 1inch Aqua / SwapVM | One-sided XYCConcentrate curves shipped through Aqua to AquaSwapVMRouter v1.0.2; priced as a covered call (above spot) and a cash-secured put (below spot); fee floor f_min = (1 + m) · C_eq / K_eq | `contracts/aqua/src/AquaCurves.sol`, `AquaCollateral.sol`, `script/ShipDemoCurves.s.sol`; `engine/pricing.py`; `web/adapters.js` (`aquaAdapter`) | 12 fork tests (`contracts/aqua/test/AquaOptionsFork.t.sol`); e2e 5 ships the curve from the page and a taker fills it, both receipts verified; `/v1/aqua/price` gives `fee_instruction_min` 2,013,952, equal to the shipped curve's fee |
| Uniswap v4 | `VolatilityFeeHook`: a dynamic fee from an EWMA of the pool's own tick returns, set in `beforeSwap` with `OVERRIDE_FEE_FLAG`; the scanner reads every v4 ETH/USDC pool | `contracts/hook/src/VolatilityFeeHook.sol`; `contracts/hook/script/HookPool.s.sol`; `engine/scanner/live.py`; `web/adapters.js` (`v4Adapter`) | 6 Foundry tests; e2e 4b swaps through the hooked pool and checks the fee paid equals `hook.getFee`; `make hook-volatile` moves the fee from 2,161 to 8,976 pips and the hooked gap goes from APPROVE to REJECT on the next block; `FEEDBACK.md` |
| Arc | `RiskPilotEscrow`: USDC escrow per `decision_id` (6-decimal ERC-20 interface), 24 h refund; the arc-worker settles verified decisions | `contracts/arc/src/RiskPilotEscrow.sol`; `engine/arc_worker.py`; `web/adapters.js` (`arcAdapter`) | 7 Foundry tests; worker unit tests (settle once, no second settle after a restart, 2/8/30 s retries); `web/e2e/arc.spec.ts` against a local Arc stand-in: one click to Settled, and a restart adds no second `Settled` event |

## Deployed addresses

| Contract | Chain | Address |
|---|---|---|
| RiskPilotEscrow | Arc testnet (5042002) | TBD (owner deploying: `make arc-deploy SENDER=0x905a…c697`) |
| VolatilityFeeHook | Unichain Sepolia (1301) | TBD (owner deploying: `make -C contracts/hook deploy-unichain-sepolia SENDER=…`) |
| VolatilityFeeHook | Demo fork (31337) | `0x3be896d4d9a52f2F29a6DB685B75E04ACAcF1080` (CREATE2; local only) |

## Speed

Measured with `web/e2e/bench.spec.ts` on the same frozen fork. "Before" is the page before the
hardening work (`64dccc6`).

| Path | Target | Before | After |
|---|---|---|---|
| Page load to first full render | < 1.5 s | 291 ms | 365 ms |
| `/evaluate` p95 | < 300 ms | 5.9 ms | 16.8 ms |
| Block to verdict on screen | < 1 s | never (no re-evaluation) | 265 ms |
| Click to first wallet prompt | < 500 ms | 33 ms | 57 ms |
| Engine down to "Source unavailable" | < 5 s | 2,889 ms | 19 ms |
| `make demo-reset` | < 30 s | no such command | 2–5 s |

## Known limits

- **No WalletConnect.** Wallets are found through EIP-6963 or `window.ethereum`.
- **No Multicall3.** Chain reads are JSON-RPC batched and run in parallel (1.5 s timeout each).
- **Position size** is capped by the profile's max position share. It is not searched for the
  largest size that passes stress and edge.
- **The arc-worker polls** `Funded` logs every 2 s from a cursor. It does not subscribe over a
  WebSocket.
- **Arc settlement is a trusted step.** The operator key settles after the engine verifies the
  trade, and the user's protection is the 24 h refund. Settlement from a cross-chain message is
  not built.
- **The hooked and static v4 pools are demo pools**, deployed and seeded on the fork by
  `make hook-pool`. The third pool is mainnet's own.
- **The v4 minimum output is checked in simulation** before each send (and again before every
  transaction). The demo router (`PoolSwapTest`) has no on-chain `amountOutMinimum`.
- **Price-gap sales don't get a holdings check in the engine.** The engine checks holdings for
  Aqua curves but not for price-gap sales. The page adapter and the SDK refuse in simulation
  instead.

## Built before vs at ETHGlobal Mumbai

- **Pre-event cut:** the `pre-eth-global` tag, `37573bb` (2026-11-06 12:11:02 +0530), the last
  Nexxore commit before the event.
- **First event commit:** `7f135a9` (2026-11-06 12:11:51 +0530), "chore: scaffold RiskPilot
  monorepo layout".
- RiskPilot was built in its own repository and brought into `nexxore-/riskpilot/` with
  `git subtree` (`65a13de`), with its history kept.

| Part | When | Notes |
|---|---|---|
| Nexxore site, agents and other services (everything outside `riskpilot/`) | before | not part of this submission |
| `riskpilot/` (schemas, engine, scanner, Aqua curves, v4 hook, Arc escrow, arc-worker, web page, SDK, tests) | at the event | written from `7f135a9` on |
| `engine/pricing.py` Black-Scholes conventions | ported | from the pre-event `strategy-builder.html` (`bsPrice`, `bsGreeks`); rewritten in Python (r = 0, theta per day, vega per vol point) |

## What's next

- **Decision-gated hook.** The v4 hook checks the engine's EIP-712 decision signature in
  `beforeSwap`, so a pool only fills flow RiskPilot approved.
- **MCP wrapper.** The v1 API as MCP tools (`evaluate`, `build`, `report`) for any agent.
- **Scanner-proposed Aqua curves.** The scanner proposes ranges and sizes instead of the two
  fixed demo curves.
- **CCTP settlement.** Settle Arc escrows from a cross-chain message (Circle CCTP, live on Arc
  testnet) instead of the operator key.
