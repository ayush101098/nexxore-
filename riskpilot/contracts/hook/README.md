# contracts/hook — PRD 4: VolatilityFeeHook (Uniswap v4)

This hook sets an ETH/USDC pool's swap fee from the pool's own realized
volatility, inside fixed bounds, with no external oracle. RiskPilot's scanner
reads this pool's price and fee from the chain, and the agent executes
through it.

```bash
make test        # 6 tests
make hook-demo   # same swaps through the hooked pool and a static 0.30% pool, on the demo chain (simulated)
make hook-pool   # deploy the hook + live pools on the demo chain (needs make demo-chain in ../aqua)
make deploy-unichain-sepolia   # public testnet, needs a funded DEPLOYER_PRIVATE_KEY
```

## Where to look

**Everything is in `src/VolatilityFeeHook.sol`:**

| What | Lines |
|---|---|
| Permissions: `afterInitialize` and `beforeSwap` | 72–89 |
| Fee rule: `feeForSigma`, clamp(500 + 5,000 · σ_ann, 500, 10,000) pips | 101–105 |
| `afterInitialize`: requires a dynamic-fee pool, stores the starting tick | 107–112 |
| `beforeSwap`: once per block, update the estimate, return fee \| `OVERRIDE_FEE_FLAG` | 114–126 |
| Estimator `_update`: capped tick return, EWMA, σ_ann, fee, `FeeUpdated` | 128–155 |

## Mechanism

1. **Dynamic-fee pool.** The pool is initialized with
   `LPFeeLibrary.DYNAMIC_FEE_FLAG`. `afterInitialize` reverts with
   `MustUseDynamicFee` for any other fee, and stores the starting tick.
2. **Once per block.** On the first swap of a new block, `beforeSwap` reads the
   tick (`StateLibrary.getSlot0`) and computes the log return since the last
   update as r = Δtick × ln(1.0001), with |Δtick| capped at 200 ticks (≈ 2%).
3. **EWMA, β = 0.94.** v_t = β v_{t−1} + (1 − β) r_t², and
   σ_ann = √(v_t · N), where N is blocks per year: 2,628,000 at 12 s
   (Ethereum mainnet and the demo fork), 31,536,000 at 1 s (Unichain Sepolia,
   measured on-chain).
4. **Fee.** fee = clamp(500 + 5,000 × σ_ann, 500, 10,000) pips, where
   1,000,000 = 100%. That's 0.05% at zero volatility, 0.30% at 50% and the 1.00%
   cap at ≥ 190%. `beforeSwap` returns it OR'd with
   `LPFeeLibrary.OVERRIDE_FEE_FLAG`.
5. **Views and events.** `getVolatility(poolId)` (WAD, 1e18 = 100%) and
   `getFee(poolId)` serve the scanner, and `FeeUpdated(poolId, sigma, fee)` is
   emitted on each update.

**Gaps of several blocks.** If Δ > 1 blocks have passed since the last update,
the return is spread evenly over those blocks and the EWMA decays by β^Δ:
v = β^Δ v + (1 − β^Δ) r²/Δ. With Δ = 1 this is the formula above. Without
the adjustment, a quiet pool's first swap after an hour would count an hour's
move as a single block's.

### Manipulation

Several swaps in one block can't move the estimate, because only the first
swap of a block reads the tick. To push the fee up, someone has to hold the
price away from its level *across* blocks, and they pay the pool's fee on
every swap they use to do it. The 200-tick cap bounds what any single block
can add.

### Known limits

- **Tick quantization.** The estimator sees integer ticks, so a price that
  flips across a tick boundary each block registers a 1-tick (0.01%) return.
  At 12 s blocks that's a floor of roughly 16% σ_ann while the price moves at
  all. In the low-volatility test the fee settles at about 0.06%, not exactly
  0.05%.
- **Lag.** The estimate measures each block's move at the next block's first
  swap, so the fee reacts one block late. After a volatile spell it decays with
  a half-life of about 11 blocks (β = 0.94).
- **LP fee income only.** `make hook-demo` compares the fees LPs earn. It
  doesn't model adverse selection.

## Tests (`test/VolatilityFeeHook.t.sol`)

| PRD 4 test | Test |
|---|---|
| Low-volatility sequence: fee stays near 500 | `test_LowVolatilityKeepsFeeNearFloor` (≤ 700, see Known limits) |
| High-volatility sequence: fee rises, never above 10,000 | `test_HighVolatilityRaisesFeeWithinCap` |
| Two swaps in one block: one estimator update | `test_TwoSwapsInOneBlockUpdateOnce` (counts `FeeUpdated`) |
| A tick jump beyond 200 is capped | `test_TickJumpIsCappedAt200` (σ equals the 200-tick value) |
| A non-dynamic-fee pool can't initialize | `test_NonDynamicFeePoolCannotInitialize` (checks the revert reason) |

Plus `test_FeeRule`: 0 → 500, 0.5 → 3,000, ≥ 1.9 → 10,000.

## Demo chain

Deploy targets, in order:

1. **The demo chain:** the Anvil mainnet fork from `../aqua` (`make demo-chain`),
   pinned at block 26,354,292, using the mainnet PoolManager
   `0x000000000004444c5dc75cB358380D2e3dE08A90` from Uniswap's deployments page.
2. **Live pools (`make hook-pool`):** a hooked dynamic-fee USDC/WETH pool and a
   static 0.30% pool. Both are priced 50 ticks (≈ 0.5%) above the fork's main
   ETH/USDC v4 pool, and each holds 100 WETH of liquidity.
   - **Price:** the fork's ETH price is **$2,218.55**, read from the main pool,
     and the hooked pool opens at $2,229.27, a 48 bp gap the scanner reports.
   - **Fee history:** a short calm → volatile → calm sequence of real swaps
     gives the page an on-chain fee history.
   - **Spacing:** mainnet already has a USDC/WETH 0.30% pool at spacing 60, so
     the comparison pool uses spacing 20.
3. **`make hook-demo`** runs calm, normal, volatile and calm-again phases, one
   swap per block, through both pools on the demo chain's state. A recent run:

| Phase (per-block move) | Hook fee | Static |
|---|---|---|
| calm (~1 tick) | 0.05% → 0.098% | 0.30% |
| normal (~3 ticks) | 0.10% → 0.199% | 0.30% |
| volatile (~50 ticks) | 0.206% → 1.000% (capped from the 2nd block) | 0.30% |
| calm again | 1.000%, σ decaying 523% → 329% over 16 blocks | 0.30% |
| **LP fee income** | **$677.66** | **$239.68** |

During the calm phase traders paid 0.07–0.10%, against 0.30% in the static pool.

## Public testnet

`make deploy-unichain-sepolia` deploys to Unichain Sepolia (chain 1301):

- **PoolManager:** `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`, from the
  deployments page.
- **Blocks per year:** 31,536,000.
- **Dry run:** a dry run against the live chain mines the hook address
  `0xf9874aeC0137f5A0ffE1F75A0A3B56381EF99080` and needs about 0.000003 ETH.
- **Not deployed yet.** TODO: deploy from a funded testnet key, then add the
  address and the deploy transaction link here.
