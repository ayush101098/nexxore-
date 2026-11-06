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

Demo curves on the fork's price (w = 1.275, spot $2,218.55, vol 55%). f_min doesn't depend on spot,
so the fee instructions match the $3,400 fixture's. From
`tests/fixtures/aqua_premium.json` and `/aqua/price`:

| Curve | Range | K_eq | T_eq | C_eq | f_min | Fee instruction ≥ |
|---|---|---|---|---|---|---|
| upside, call-like | 2,218.55–2,828.65 | 2,505.10 | 6.99 d | 4.20 | 0.2014% | 2,013,952 |
| downside, put-like | 1,740.04–2,218.55 | 1,964.78 | 6.99 d | 3.72 | 0.2274% | 2,274,072 |

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

Upside curve on held ETH at the fork's spot (2,218.55–2,828.65, 55% vol, Balanced, fee 2,013,952,
measured ship gas at the chain's 1.05 gwei):

| q (WETH) | Net edge | Hurdle | Verdict |
|---|---|---|---|
| 5 | 4.01 | 5.00 | REJECT |
| 6 | 4.86 | 5.00 | REJECT |
| **7** | **5.70** | **5.00** | **APPROVE**, the demo size |
| 8 | 6.54 | 5.00 | APPROVE |
| 10 | 8.22 | 6.14 | APPROVE |

The premium per ETH scales with the ETH price, so the smallest curve that approves is 7 ETH here.
At $3,400 it was 5 ETH (see `aqua_upside_held_eth.json`). The margin is thin: $0.70 over the
hurdle.

### Demo seed (`POST /demo/seed`)

Everything comes from the demo chain when it's up. Here is one run:

| Opportunity | Verdict | Why |
|---|---|---|
| Price gap: hooked v4 pool, $10,000 | REJECT | The $48.09 gap (48 bp) loses to the hook's 1% fee ($100), $114.16 of slippage from V4Quoter at size, and the $5 hedge |
| Put-like curve: 1,964.78 USDC, 1,740–2,219 | REJECT | Adds $629.93 of loss at −40% on top of the wallet's 8 WETH; $7,729.29 is above the $250 budget |
| Call-like curve: 7 WETH, 2,219–2,829 | APPROVE | Net edge $5.71 clears the $5.00 hurdle, and the worst stress loss falls from $7,099.36 to $7,069.93 |

Each input comes from the chain:
- the gap from StateView (hooked vs main pool);
- the quote at size from V4Quoter;
- the fee and σ from the hook;
- gas from `eth_gasPrice`;
- the Aqua spot from the main ETH/USDC pool;
- holdings from `balanceOf`.

The Aqua curves use a stated 55% implied vol. If a source is down, the seed falls back to the
recorded fixtures and the `sources` report says so.

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
