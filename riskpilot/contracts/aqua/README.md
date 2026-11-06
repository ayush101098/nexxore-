# contracts/aqua — PRD 3: Aqua Options (1inch)

From one maker wallet, this ships two SwapVM curves through 1inch Aqua that
behave like a covered call and a cash-secured put. They run against the
**deployed AquaSwapVMRouter v1.0.2 on an Ethereum mainnet fork**, and every
fill is a real token transfer.

These are options-like payoffs from swap curves, not option contracts.

```bash
export AQUA_FORK_RPC_URL=<Ethereum mainnet archive RPC>
make test         # init pinned submodules, fork at the pinned block, run the whole flow
make demo-chain   # persistent Anvil fork with both demo curves shipped (state survives restarts)
make demo-fill CURVE=upside    # scripted taker; CURVE=downside sells ETH to the put-like curve
make demo-reset   # forget the saved demo state
```

- **Pinned block:** forks are pinned to `DemoParams.FORK_BLOCK` (26,354,292).
  Override it with `AQUA_FORK_BLOCK`.
- **RPC:** the public default RPC only keeps about 100 recent blocks, so after
  that the pinned block needs a dedicated archive RPC.

## Demo chain

`make demo-chain` runs `script/demo-chain.sh`:

1. Start `anvil --fork-block-number <pinned>`.
2. Fund the maker (Anvil account #0) and the taker (#1) with ETH using
   `anvil_setBalance`, then wrap it to WETH.
3. Fund USDC by impersonating a large USDC holder (`anvil_impersonateAccount`)
   and transferring from it. The holder isn't hardcoded:
   `script/find_usdc_holder.py` picks the ordinary wallet (not a contract) with
   the largest balance among recent USDC transfer counterparties at the pinned
   block.
4. Run `script/ShipDemoCurves.s.sol` with `SHIP=none`. It writes
   `demo/curves.json` (orders, strategy hashes, ranges, fees) and doesn't ship
   anything: the `/riskpilot` page ships the approved call-like curve when the
   user signs. `make demo-ship` ships it from the command line instead.

The fork runs as chain ID 31337, so a browser wallet can't confuse it with
mainnet. The maker holds 8 WETH, which covers the 7 ETH call-like curve.

**One ETH price.** The demo curves sit on the fork's own price: `DemoParams.SPOT` is $2,218.55, the
main ETH/USDC v4 pool at the pinned block, and `test_DemoSpotIsTheForksEthPrice` checks it through
StateView. The v4 hook pool (`contracts/hook`) uses the same chain and the same price.

State is dumped to `demo/anvil-state.json` every 10 s and on Ctrl-C, and the
next run reloads it with `--state`. If setup fails partway, the half-built
state is deleted.

Demo curves (w = 1.275, `src/DemoParams.sol`):

| Curve | Range | K_eq | T_eq @ 55% vol | Fee instruction (1e9 = 100%) |
|---|---|---|---|---|
| upside, call-like, 7 ETH | 2,218.55–2,828.65 | 2,505.10 | 6.99 d | **2,013,952** (0.2014% = engine f_min, rounded up) |
| downside, put-like, 1,964.78 USDC | 1,740.04–2,218.55 | 1,964.78 | 6.99 d | **2,274,072** (0.2274%) |

The fork test's own unit curves stay at w = 1.10, which is about a 1-day
equivalent term.

## Gate 1: can XYCConcentrate sit entirely above or below spot? Yes.

Read from swap-vm `v1.0.2` (`src/instructions/XYCConcentrate.sol`) and Aqua `0.1.0`:

- **The instruction takes two bounds.** `XYCConcentrate` takes `sqrtPriceMin`
  and `sqrtPriceMax` (sqrt price, 1e18 fixed point, P = tokenGt / tokenLt). It
  does not take a spot price. It derives L and its own spot from the curve's
  real balances on every swap.
- **A one-token curve sits at the edge of its range.** With only tokenGt
  (`bLt = 0`), the implied price is exactly `P_max`. With only tokenLt
  (`bGt = 0`), it is exactly `P_min`. The curve trades only in the direction
  that moves price back into the range.
- **Upstream already tests this.** swap-vm's own tests cover both cases:
  `test_ZeroBalance_SpotAtUpperBound` and `test_ZeroBalance_SpotAtLowerBound`
  in `test/XYCConcentrate.t.sol`.
- **Aqua accepts a zero amount.** `Aqua.ship` takes `0` for one token, and
  `safeBalances` still treats that token as active in the strategy.

On mainnet, USDC (`0xA0b8…`) has a lower address than WETH (`0xC02a…`). So P
is WETH per USDC, and a rising ETH price means a falling P. `AquaCurves`
handles that flip.

## Design

| Curve | USD range | Funded with | Behaviour | Equivalent |
|---|---|---|---|---|
| Upside | spot → spot × w | ETH only | sells ETH for USDC as price rises | covered call, K ≈ √(low × high) |
| Downside | spot ÷ w → spot | USDC only | buys ETH with USDC as price falls | cash-secured put, K ≈ √(low × high) |

The width is w = 1.10. Each program runs these four instructions in order:

1. `XYCConcentrate(sqrtMin, sqrtMax)`
2. `FlatFee(0.30%)`, which is the maker's premium
3. `XYCSwap`
4. `Salt`

Opcode bytes come from swap-vm's own `ProgramBuilder`, which looks each
instruction up in the `AquaOpcodes` table that the router runs. The test
checks that the builder emits `0x11` for XYCSwap, the same byte as 1inch's
strategy template.

## Collateral invariant

Aqua balances are allowances. `ship` locks nothing, and a fill `pull`s from the
maker's wallet with `transferFrom`. Nothing on-chain stops a maker from
promising more than they hold, so `AquaCollateral.check` runs before every ship
and refuses a plan when, for any token, the sum of the curves' maximum outflow
is greater than min(wallet balance, allowance to Aqua). That sum includes
curves already live.

The upside curve can pay out at most its ETH, and the downside curve at most
its USDC.

The claim we make is: **one wallet, two options-like positions, no capital
locked in a pool.** We don't claim that the two curves share capital.

## What the fork test shows

`test/AquaOptionsFork.t.sol` runs these checks against the deployed router and Aqua:

| Acceptance | Test |
|---|---|
| Both curves shipped from one wallet | `test_BothCurvesShipFromOneWallet`. The strategy hashes match `router.hash`, the Aqua balances are as shipped, and the wallet is untouched. |
| Taker fill moves tokens, balances printed | `test_TakerFillMovesTokens`. Every transfer is asserted, and the results are written to `out/aqua-fill.json` for the UI. |
| Downside fill | `test_DownsideFillMovesTokens`. The taker sells WETH to the put-like curve, and every transfer is asserted. |
| Demo curves price in range | `test_DemoCurvesShipAndPriceInRange`. The ask is 3,408.01 (spot + 0.2014%) and the bid is 3,391.83 (spot − 0.2274%). |
| `quote()` is consistent with the range | `test_QuoteIsConsistentWithTheRange`. A small buy prices at spot plus the fee; a large buy prices above that but below the range top. |
| Collateral check refuses over-allocation | `test_CollateralCheck*`: single curve, two curves on one token, live strategies, allowance |
| Whole flow from a clean fork in one command | `make test` |

One run of the w = 1.10 unit test (spot $3,400, 1 ETH upside curve, taker spends 1,500 USDC):

```
before fill   maker 2.000000 WETH  5,000 USDC   taker 5.000000 WETH  10,000 USDC
after fill    maker 1.568970 WETH  6,500 USDC   taker 5.431030 WETH   8,500 USDC
fill price 3,480.04 USDC/ETH · marginal price 3,414.88 → 3,556.26 · K_eq 3,565.95
```

## Things the adapter must handle

- **`quote()` ignores the curve's real balances.** It runs the curve maths on
  virtual reserves, so it returns a price even for the direction a one-sided
  curve can't fill. The real swap then reverts, because Aqua's `pull`
  underflows; `test_OneSidedCurveOnlyTradesOneWay` checks this. The adapter
  must cap any quote at the curve's real Aqua balance of `tokenOut`
  (`aqua.safeBalances`).
- **KycNFT taker gate.** On live chains, 1inch's template starts a program with
  `onlyTxOriginTokenBalanceNonZero(KycNFT 0x26FF…a468)`, which is opcode
  `0x21`. It's a maker-side instruction, not router logic. These curves leave
  it out, so they are permissionless and the fork needs no KYB taker. To gate
  production curves, add it as the first instruction.

## Sources

- [Aqua getting started](https://business.1inch.com/portal/documentation/aqua/getting-started)
- [Contract addresses](https://business.1inch.com/portal/documentation/aqua/reference/contract-addresses): Aqua and the router share one address on 13 chains
- [Strategy template](https://business.1inch.com/portal/documentation/aqua/getting-started/strategy-template): the KycNFT gate encoding and the fork test pattern
- [SwapVM FAQ](https://business.1inch.com/portal/documentation/aqua/help/swapvm-faq)
- [1inch/swap-vm@v1.0.2](https://github.com/1inch/swap-vm/tree/v1.0.2) and [1inch/aqua@0.1.0](https://github.com/1inch/aqua/tree/0.1.0)

Licences: swap-vm and Aqua are under Degensoft's source licences (see
`lib/*/LICENSE*`). This folder imports them and doesn't modify them. Our code
is MIT.
