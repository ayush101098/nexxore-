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

### Aqua premium rule

A fully crossed range trades about q ETH at an average price of K_eq, so a
curve fee of f earns about f · K_eq per ETH. Meanwhile the curve writes an
options-like payoff worth C_eq, which is Black-Scholes at K_eq and T_eq. The
curve's fee must cover that value plus a markup m = 0.20:

```
f_min = (1 + m) · C_eq / K_eq
```

- **Edge:** for `aqua_premium` decisions, the gross edge is q · (f · K_eq − C_eq),
  and the fee is income rather than a cost line.
- **New rule:** an extra rule (3b, after the gas check) rejects a curve whose
  fee is below f_min.
- **Recorded:** every `aqua_premium` Decision records K_eq, T_eq, C_eq and f_min
  in `inputs.aqua`.
- **Also from `/aqua/price`:** it returns `premium_floor.fee_instruction_min`,
  which is f_min in SwapVM flat-fee units (1e9 = 100%), rounded up.

Demo curves (w = 1.275, spot $3,400, vol 55%), from
`tests/fixtures/aqua_premium.json` and `/aqua/price`:

| Curve | Range | K_eq | T_eq | C_eq | f_min | Fee instruction ≥ |
|---|---|---|---|---|---|---|
| upside, call-like | 3,400–4,335 | 3,839.14 | 6.99 d | 6.44 | 0.2014% | 2,013,952 |
| downside, put-like | 2,666.67–3,400 | 3,011.09 | 6.99 d | 5.71 | 0.2274% | 2,274,072 |

### Existing holdings count in the book

`/evaluate` takes `holdings: {weth, usdc}`. Alternatively, it takes `wallet`
and reads the balances over RPC from `DEMO_RPC_URL` (default
`http://127.0.0.1:8545`, the demo chain).

- **Before-book:** held WETH is added as spot ETH.
- **After-book:** ETH that a curve takes from the wallet moves into the curve
  position. So an upside curve on held ETH swaps "held ETH" for "held ETH plus
  a short call", and its ΔR is ≤ 0.
- **Collateral:** a curve that needs more WETH or USDC than the wallet holds is
  rejected (rule 3).
- **Rule 4:** a trade that doesn't raise the worst loss isn't rejected for
  losses the wallet already carried. Only a trade that raises the worst loss
  above the budget is rejected.

For `aqua_premium` decisions:

```
net edge = (f · K_eq − C_eq) · q − gas_ship − λ · max(0, ΔR)
```

The last term is 0 for an upside curve on held ETH. `gas_ship` is a measured
`ship` costing 81,416 gas.

Upside curve on held ETH (3,400–4,335, 55% vol, Balanced, gas_ship $0.42):

| q (WETH) | m | Fee instruction | Net edge | Hurdle | Verdict |
|---|---|---|---|---|---|
| 1 | 0.20 | 2,013,952 | 0.87 | 5.00 | REJECT |
| 5 | 0.20 | 2,013,952 | 6.02 | 5.00 | **APPROVE** |
| 10 | 0.20 | 2,013,952 | 12.47 | 9.42 | APPROVE |
| 1 | 0.50 | 2,517,440 | 2.80 | 5.00 | REJECT |
| 5 | 0.50 | 2,517,440 | 15.69 | 5.00 | APPROVE |
| 10 | 0.50 | 2,517,440 | 31.80 | 9.42 | APPROVE |

## Quote cap

Aqua's `quote()` runs the curve maths on virtual reserves, so it prices
trades that a one-sided curve can't fill, and those trades revert (see
`contracts/aqua`). When a venue reports its real balances, the scanner caps
each opportunity at what the venue can actually pay out:

- if the venue is above the reference price, we would sell ETH to it, so the
  cap is its USDC balance;
- if it is below, we would buy ETH from it, so the cap is its ETH balance × price.

When the cap is zero, the scanner drops the opportunity.

## Sources

`scanner/recorded.py` replays `data/recorded_quotes.json`, which is the
default. The hooked v4 pool, the Uniswap Trading API and the Aqua router
quote() sources in `scanner/live.py` have their interfaces fixed. Until their
PRDs wire them up, they return 501 with a TODO.

## Known limits

- `/scan` emits only `price_gap` opportunities so far. `aqua_premium` and
  `vol_regime` come with PRDs 3 and 4.
- `/evaluate` treats a `price_gap` trade as spot exposure on the v4 pool.
- **Holdings matter for `aqua_premium` curves.** Without them, a curve's ETH
  counts as new exposure, and a 1 ETH upside curve fails stress ($1,353.56 at
  −40%; see `aqua_premium.json`). With held ETH it is risk-reducing (see
  `aqua_upside_held_eth.json`). A downside put-like curve on USDC adds about
  $965 of loss at −40%, so it is rejected (see `aqua_downside.json`).
- In the stress grid, Aqua curves are repriced on vol shocks as their
  equivalent option, as the PRD specifies. The curve's token balances depend
  only on price, so this convention overstates vol risk rather than hiding it.
