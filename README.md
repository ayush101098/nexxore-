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

TODO: everything in this repository was written during ETHGlobal. Pre-existing
Nexxore code (the frontend and the stress-scenario grid) lives in a separate
repository, tagged `pre-eth-global`. List here exactly which files are copied or
adapted from that tag.

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

TODO: deployed addresses and links to the key lines for each sponsor
integration.

| Component | Chain | Address | Key lines |
|---|---|---|---|
| VolatilityFeeHook | TODO (Uniswap v4 testnet) | TODO | TODO |
| Aqua Options curves | TODO (Anvil fork; confirm chain in 1inch docs) | AquaSwapVMRouter v1.0.2 | TODO |
| RiskPilotEscrow | Arc testnet | TODO | TODO |

## Setup

```bash
cp .env.example .env          # fill in testnet RPCs and keys
python3 -m venv .venv && .venv/bin/pip install -r shared/requirements.txt
.venv/bin/pytest shared/tests
```

TODO: engine, contracts and web setup.

## Demo

TODO: demo script in `docs/`.
