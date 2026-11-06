# RiskPilot: pricing liquidity risk

Risk-aware execution engine for programmable liquidity (ETH/USDC).

## What it is

RiskPilot connects **scan → quantify → decide → approve → execute → settle → record**.
The engine prices every opportunity net of gas, slippage, fees, hedge cost and a
risk charge, stress-tests the post-trade book against the user's loss budget, and
issues a Decision: `APPROVE`, `REJECT`, `REQUOTE` or `REQUIRE_REVIEW`, with a
one-sentence reason. Every on-chain action traces back to a `decision_id`.

Primitives:

- **Aqua Options (1inch)**: options-like payoffs from swap curves. Two
  XYCConcentrate ranges funded from one wallet, a covered-call-like range above
  spot and a cash-secured-put-like range below spot.
- **Volatility-aware v4 hook (Uniswap)**: a dynamic fee driven by an EWMA of the
  pool's own squared log returns, with no external oracle.
- **Arc USDC settlement**: an escrow keyed by `decision_id` that records each
  approved strategy's lock and settlement.

Out of scope: automated execution, mainnet funds, multi-asset support.

**Profiles, chosen once.** A wallet picks Conservative, Moderate or Aggressive on first connect
and signs it (EIP-191). Every limit is fixed by the profile (λ, stress budget share and cap,
minimum edge, k, Aqua fee margin, max slippage, max position share). Each block the engine
derives the rest: stress budget = min(share × wallet value, cap), slippage limit =
min(profile max, simulated impact + 5 bp), position cap, and gas ceiling = 2 × base fee + tip
(`eth_feeHistory`). For the demo wallet the Moderate budget is the $250 cap.

**One action.** The page scans, evaluates, sizes and requotes on every block by itself; the
user's only trade control is **Approve and sign** (plus Refund after 24 h on Arc). One click
runs every transaction the decision needs (exact-amount approvals, the trade, the Arc funding)
as a stepper, or as one EIP-5792 batch when the wallet supports it, re-validating and
re-simulating before each. The arc-worker settles on Arc without anyone pressing anything.

## Pre-event vs event work

Everything in this repository was written during ETHGlobal. Pre-existing Nexxore
code lives in a separate repository, tagged `pre-eth-global`. Anything taken
from it is listed here:

| Here | From `pre-eth-global` | How |
|---|---|---|
| `engine/pricing.py` | `strategy-builder.html` (`bsPrice`, `bsGreeks`) | Black-Scholes conventions ported from JavaScript to Python (r = 0, theta per day, vega per vol point). The code was rewritten. |

The stress grid, verdict logic, Aqua mapping, scanner and API are new.

## Architecture

TODO: diagram in `docs/`.

```
riskpilot/
  engine/            # PRD 2: FastAPI app, scanner, quant functions, tests
  contracts/
    hook/            # PRD 4: VolatilityFeeHook.sol
    aqua/            # PRD 3: Aqua fork scripts, curve builder
    arc/             # PRD 5: RiskPilotEscrow.sol
  web/               # PRD 6: risk terminal + execution adapters
  shared/schemas/    # Opportunity, Decision, Position, Execution (JSON Schema)
  docs/              # architecture diagram, demo script
```

Every module reads and writes the schemas in `shared/schemas/`, with no private
copies. Adapters in `web/` implement `validate`, `simulate`, `buildTx` and
`verify`. The engine decides and the adapter only implements. After `verify`, the
web app POSTs the Execution to the engine's `/executions`, which updates the
Position.

## Contracts and lines

| Component | Chain | Address | Key lines |
|---|---|---|---|
| VolatilityFeeHook | Demo chain (mainnet fork @ 26,354,292); Unichain Sepolia: pending your deploy | demo: `0x3be8…1080`; Sepolia (mined): `0xf987…9080` | `contracts/hook/src/VolatilityFeeHook.sol`: `beforeSwap` 114–126, fee rule 101–105, estimator 128–155 |
| Aqua Options curves | Demo chain, deployed AquaSwapVMRouter v1.0.2 `0x1111…0de` | strategy hashes in `contracts/aqua/demo/curves.json` | `contracts/aqua/src/AquaCurves.sol`, `AquaCollateral.sol` |
| RiskPilotEscrow | Arc testnet (5042002), pending your deploy | dry run from your wallet: `0x64c1…e51E` | `contracts/arc/src/RiskPilotEscrow.sol` |

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r shared/requirements.txt -r engine/requirements.txt
cp .env.example .env              # AQUA_FORK_RPC_URL: an Ethereum mainnet archive RPC
make up                           # demo chain :8545 + engine :8000; first run builds and freezes it
open http://localhost:8000/riskpilot
make demo-reset                   # back to the frozen chain and SQLite copy, same decision ids, ~3 s
ARC_REHEARSAL=1 make demo-reset   # plus a local Arc stand-in: Approve and sign -> fund -> worker settles
make test                         # engine + schema tests, then the e2e suite
make outage-test                  # kill the engine for real, headed browser
make down
```

Contracts: `cd contracts/{aqua,hook,arc} && make test` (12, 6 and 7 Foundry tests).

**Public testnets, from your own wallet** (forge prompts for the key; nothing is stored):
`make testnet SENDER=0xYourAddress` deploys the hook to Unichain Sepolia and the escrow to Arc
(`make arc-deploy` alone writes `contracts/arc/deployments/arc-testnet.json`). Then start the
engine with `ARC_OPERATOR_KEY` exported in your terminal and the arc-worker settles every funded
decision. Without it, decisions show "Funded · waiting for operator key".

## Using it from a wallet or agent: API v1

The engine's API is versioned under `/v1` (the unversioned paths remain as aliases). The spec is
`docs/openapi.yaml` (`make openapi`), also served at `/v1/openapi.json`.

| Endpoint | Does |
|---|---|
| `PUT /v1/profile` | Set the wallet's profile; body `{wallet, profile, set_at, signature}`, EIP-191 over the message in `api.profile_message` |
| `GET /v1/opportunities?wallet=` | The wallet's evaluated opportunities this block |
| `GET /v1/stream?wallet=` | Server-sent events: `block`, `opportunity`, `decision`, `health`, `settlement`; 15 s heartbeat |
| `POST /v1/evaluate` | Evaluate any opportunity; with `wallet`, under its profile and derived limits |
| `GET /v1/decisions/{id}` | A stored decision, with its EIP-712 signature |
| `POST /v1/decisions/{id}/build` | EIP-5792 `calls[]` for a live, signed APPROVE; 409 if expired, not APPROVE, unsigned, or made under an old profile |
| `POST /v1/executions` | Report a verified execution (idempotent) |
| `GET /v1/positions?wallet=` | Open positions |
| `POST /v1/decisions/{id}/replay` | Re-run from recorded inputs; must be identical |
| `GET /v1/health`, `GET /v1/metrics` | Dependencies and warnings; p50/p95 per route |

Decisions are signed by the engine key (`RISKPILOT_ENGINE_KEY`; ephemeral if unset, and
`/v1/health` says so) as EIP-712 `RiskPilotDecision{id, wallet, inputsHash, verdict, expiresAt}`.
`decision_id` = hash(inputs, block, engine version).

## What's next

- **Decision-gated hook.** The v4 hook checks the engine's EIP-712 decision signature in
  `beforeSwap`, so a pool only fills flow that RiskPilot approved.
- **MCP wrapper.** The v1 API as MCP tools, so any agent can `evaluate`, `build` and `report`.
- **Scanner-proposed curves.** The scanner proposes Aqua ranges and sizes, instead of the two
  fixed demo curves.
