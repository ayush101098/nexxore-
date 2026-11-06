# Developer feedback: Uniswap v4

## What we built

`VolatilityFeeHook` (`contracts/hook/src/VolatilityFeeHook.sol`) was built from
uniswapfoundation/v4-template (commit 1fbf955) during ETHGlobal.
- **`afterInitialize`** rejects pools without `DYNAMIC_FEE_FLAG`.
- **`beforeSwap`**, on the first swap of each block, reads the tick (`StateLibrary.getSlot0`) and
  updates an EWMA of squared tick returns (β = 0.94, at most 200 ticks per block, β^Δ decay over
  skipped blocks).
- **The fee** is clamp(500 + 5,000 · σ_ann, 500, 10,000) pips, returned with
  `OVERRIDE_FEE_FLAG`. No oracle.
- **Result:** at 2,161 pips, a $10,000 gap nets $15.38 through the hooked pool, against $7.19
  through a static 0.30% pool. At 8,976 pips, RiskPilot rejects it.

## What worked

- **The template.** `BaseHook` only needed `_afterInitialize` and `_beforeSwap`.
- **Fee override.** `fee | OVERRIDE_FEE_FLAG` from `beforeSwap` needs no `updateDynamicLPFee`
  call and no extra PoolManager state.
- **Fork testing.** On a mainnet fork, the deployments page's PoolManager, StateView and V4Quoter
  matched on-chain. V4Quoter's `gasEstimate` fed our gas cost.
- **The `Swap` event's fee field** lets us compare quoted and paid fees per receipt.

## What was hard

- **Fee units.**
  - Fees are in pips, `DYNAMIC_FEE_FLAG` is `0x800000` and `OVERRIDE_FEE_FLAG` is `0x400000`, and
    no doc puts the three in one table.
  - We first wrote 0.30% as `30`.
- **HookMiner.**
  - `HookAddressNotValid` doesn't say which permission bits were expected.
  - In a simulated `forge script`, `new Hook{salt: s}()` deploys from the script, not
    `CREATE2_FACTORY`, so the mined address misses. We call the deployer directly.
- **The template.**
  - It pins solc 0.8.30, while v4-core's PoolManager is `=0.8.26`, so importing `Deployers` fails
    to compile until the pin is removed. Under 0.8.26, `require(cond, CustomError())` needs via-IR.
  - Its `Deployers` deploys a fresh PoolManager on chain 31337, which ignores the real one on a
    mainnet fork.
- **Errors.**
  - PoolManager wraps hook reverts in `CustomRevert.WrappedError`, so tests dig through revert
    bytes.
  - `PoolAlreadyInitialized` (mainnet already has USDC/WETH 0.30% at spacing 60) shows only as
    `0x7983c051`.
- **`PoolSwapTest` has no minimum output.** We check minimum output by simulation before each
  send. That is weaker than on-chain, but UniversalRouter's `V4Router` actions were too much
  encoding for the time we had.
- **Fees only move on trades.**
  - `getFee` returns the last update until someone swaps, so the fee paid can differ from the fee
    quoted. On our first swap it did.
  - An idle pool's first swap sees the whole idle period's move at once.

## Suggestions

1. **A fee-preview standard** (`previewFee(key, params)`), or V4Quoter returning the hook's
   override fee, so routers and agents can quote without copying hook logic.
2. **`amountOutMinimum` on `PoolSwapTest`**, or a minimal reference router for scripts.
3. **A dynamic-fee docs page:** the three constants, the units, and the fact that `beforeSwap`'s
   fee is ignored without the override flag.
4. **Hook-deployment docs** covering the `new{salt}` simulation behaviour. `HookAddressNotValid`
   should name the expected bits.
5. **Template:** match v4-core's solc pin, and make `Deployers` accept an existing PoolManager.
6. **Block times next to the deployment addresses**, for annualizing per-block estimators. We
   measured Unichain Sepolia's 1.0 s ourselves.

---

**Arc, briefly.** The docs state clearly that native USDC (gas) uses 18 decimals while the ERC-20
interface at `0x3600…0000` uses 6, sharing one balance. The escrow uses only the ERC-20
interface.
