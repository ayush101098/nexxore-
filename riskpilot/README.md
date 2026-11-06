# RiskPilot

A risk-aware DeFi execution agent for ETH/USDC.

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
cp .env.example .env          # fill in testnet RPCs and keys
python3 -m venv .venv && .venv/bin/pip install -r shared/requirements.txt
.venv/bin/pytest shared/tests

cd engine                     # quant engine, see engine/README.md
../.venv/bin/pip install -r requirements.txt
../.venv/bin/pytest
../.venv/bin/uvicorn main:app --reload
```

```bash
export AQUA_FORK_RPC_URL=<Ethereum mainnet archive RPC>
cd contracts/aqua && make demo-chain      # demo chain on :8545 (Anvil fork, chain 31337)
cd contracts/hook && make hook-pool       # VolatilityFeeHook + live pools on the demo chain
cd engine && DEMO_RPC_URL=http://127.0.0.1:8545 ../.venv/bin/uvicorn main:app
open http://localhost:8000/riskpilot      # the demo page (also served at nexxore.xyz/riskpilot)
cd contracts/hook && make test hook-demo  # 6 tests; fee per block vs a static 0.30% pool
cd contracts/arc && make test             # 7 tests; make deploy-arc-testnet once the key is funded
```

## Demo

TODO: demo script in `docs/`.
