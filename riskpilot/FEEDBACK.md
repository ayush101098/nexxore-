# Uniswap v4 feedback

## What we built

`VolatilityFeeHook` (`contracts/hook/src/VolatilityFeeHook.sol`) is a dynamic-fee hook for
ETH/USDC.
- **Permissions:** `afterInitialize` rejects pools without `DYNAMIC_FEE_FLAG`.
- **Estimator:** on the first swap of each block, `beforeSwap` reads the tick
  (`StateLibrary.getSlot0`). It updates an EWMA of squared tick returns (β = 0.94, at most 200
  ticks per block), decayed over the blocks since the last update.
- **Fee:** clamp(500 + 5,000 · σ_ann, 500, 10,000) pips, returned with `OVERRIDE_FEE_FLAG`.
- **Use:** RiskPilot reads `getFee` and `getVolatility` and prices each trade at the fee it will
  pay.
  - At 2,161 pips (calm), a $10,000 gap nets $15.38 through the hooked pool, against $7.19 through
    a static 0.30% pool.
  - At 8,976 pips (volatile), the same gap is rejected.

## What worked

- **Fee override.** Returning the fee from `beforeSwap` with `OVERRIDE_FEE_FLAG` is small and
  needs no `updateDynamicLPFee` call.
- **Fork testing.** A mainnet fork at a pinned block, with the deployed PoolManager, StateView and
  V4Quoter, let us test the hook beside the real ETH/USDC pools. V4Quoter's `gasEstimate` went
  straight into our gas cost.
- **Fee in the `Swap` event.** The event reports the fee charged, so we compare the quoted fee
  with the paid fee from each receipt.

## What was hard

- **HookMiner and CREATE2.** `HookMiner.find` works, but `new Hook{salt: s}()` only routes through
  the CREATE2 deployer when broadcasting. A simulated `forge script` deploys from the script
  address, so the mined address misses. We call `CREATE2_FACTORY` directly.
- **The template.**
  - v4-core needs `=0.8.26`, the template pinned 0.8.30, and we set `auto_detect_solc`.
  - `require(cond, CustomError())` needs via-IR in 0.8.26, so we used if/revert.
  - A static pool matching mainnet's fee and spacing hit `PoolAlreadyInitialized` on the fork. We
    moved it to spacing 20.
- **`PoolSwapTest` has no minimum output.** It is the easiest router to script against, but it has
  no `amountOutMinimum`. We check minimum output by simulation before every send, which is weaker
  than an on-chain check. UniversalRouter's encoded `V4Router` actions were more than we had time
  for.
- **Fees only move on trades.** Between swaps, `getFee` returns the last block's fee.
  - The fee paid can differ from the fee quoted at decision time, and on our first swap it did.
  - An idle pool's first swap sees the whole idle period's move at once. β^Δ decay spreads it, but
    the reading stays stale until someone trades.

## Suggestions

1. **A standard preview of the fee a swap would pay now**, such as a `previewFee(key, params)`
   convention, or V4Quoter returning the hook's override fee. Routers and agents could then quote
   without copying hook logic.
2. **An `amountOutMinimum` on `PoolSwapTest`**, or a minimal reference router in v4-periphery for
   scripts and demos.
3. **Document the `new{salt}` simulation behaviour**, and have HookMiner return deployer calldata.
4. **Template:** pin a solc that matches v4-core, and ship one `OVERRIDE_FEE_FLAG` example.
5. **A documented once-per-block hook pattern**, with its manipulation reasoning. Every volatility
   hook re-derives it.
