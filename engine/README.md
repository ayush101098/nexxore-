# engine — PRD 2

A deterministic FastAPI service that turns an Opportunity into a Decision. It
uses no AI and no randomness in the decision path, and it never reads the
clock inside the decision. The same request always gives the same verdict,
`decision_id` included.

```bash
cd engine
../.venv/bin/pip install -r requirements.txt
../.venv/bin/pytest                 # ~1 s, offline
../.venv/bin/uvicorn main:app --reload   # RISKPILOT_DB=riskpilot.db by default
```

## Endpoints

| Method and path | In | Out |
|---|---|---|
| `POST /scan` | `pair`, `sources`, `size`, `min_gap_bps`, `as_of?` | Opportunity[] |
| `POST /evaluate` | `opportunity`, `size?`, `profile`, `market?`, `book?`, `as_of?`, `tolerance`, `gas_budget` | Decision |
| `POST /aqua/price` | `spot`, `range_low`, `range_high`, `side` (`call_like` / `put_like`), `size` (ETH), `volatility` | equivalent strike and term, Greeks, premium, max loss |
| `POST /stress` | `positions` (Position[]), `spot?` | P&L per scenario, worst loss |
| `POST /executions` | Execution | updated Position |
| `GET /decisions`, `GET /decisions/{id}` | — | Decision history, one Decision |

If `/evaluate` gets no `market`, it is fetched from the source named in
`opportunity.source` (`recorded:…` → recorded quotes). If it gets no `book`,
the store's open positions are used. If it gets no `as_of`, the current time
is used. The resolved request is saved in `Decision.inputs.request`, so any
decision can be replayed.

## Decision

```
E_net = q (P_ref − P_mid) − gas − slippage − fees − hedge − λ · max(0, L_after − L_before)
```

- **Gas**: simulated gas units × gas price × ETH/USD (the quote mid).
- **Slippage**: |quote at size − mid| × q.
- **Fees**: the pool fee rate × size. For the hooked pool this is the hook's current fee.
- **Hedge**: the cost of the hedge leg. Only `1 − hedge.ratio` of the trade's
  delta is left in the book.
- **Uncertainty**: S · σ · √(quote latency in years) · q.
- **Stress grid**: spot shocks of −40%, −20%, −10%, +10%, +20%, +40% and
  +60%, each with vol shocks of 0 and +20 points. Spot positions are linear.
  Aqua curves are repriced with Black-Scholes at K_eq and T_eq.

The rules are checked in order, and the reason names the rule that fired and
its numbers:

1. Sanity bounds, or any input older than 30 s → `REQUIRE_REVIEW`
2. The quote has expired, or the mid moved more than `tolerance` (0.3%) from
   the observed price → `REQUOTE`
3. Liquidity is below the size, or gas is above `gas_budget` ($25 by default) → `REJECT`
4. The post-trade worst stress loss is above the profile budget → `REJECT`
5. The net edge is below max(min edge, k × uncertainty) → `REJECT`
6. Otherwise → `APPROVE`, expiring 30 s later

| Profile | λ | Stress budget | Min edge | k |
|---|---|---|---|---|
| conservative | 1.0 | $150 | $10 | 3 |
| balanced | 0.5 | $250 | $5 | 2 |
| aggressive | 0.25 | $500 | $3 | 1.5 |

These are starting values for the demo, not calibrated settings.

## Aqua curve mapping

For a range from P_low to P_high: K_eq = √(P_low · P_high), r = √(P_high / P_low),
and T_eq = 2π/σ² · ((√r − 1)/(√r + 1))² (Panoptic).

- A `call_like` curve sits above spot and holds ETH. It is treated as a
  covered call (long ETH plus a short call).
- A `put_like` curve sits below spot and holds USDC. It is treated as a
  cash-secured put (a short put).

These are options-like payoffs from swap curves, not option contracts.

## Sources

`scanner/recorded.py` replays `data/recorded_quotes.json`, which is the
default. The hooked v4 pool, the Uniswap Trading API and the Aqua router
quote() sources in `scanner/live.py` have their interfaces fixed. Until their
PRDs wire them up, they return 501 with a TODO.

## Known limits

- `/scan` emits only `price_gap` opportunities so far. `aqua_premium` and
  `vol_regime` come with PRDs 3 and 4.
- `/evaluate` treats the trade as spot exposure on the v4 pool. Aqua curves
  enter the book through `/executions` and `/stress`.
- In the stress grid, Aqua curves are repriced on vol shocks as their
  equivalent option, as the PRD specifies. The curve's token balances depend
  only on price, so this convention overstates vol risk rather than hiding it.
