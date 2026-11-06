# Developer feedback

## Uniswap v4 (VolatilityFeeHook, `contracts/hook`)

Built from [uniswapfoundation/v4-template](https://github.com/uniswapfoundation/v4-template)
(commit 1fbf955) during ETHGlobal, 6 Nov 2026.

### What was easy

- **The template got us started in minutes.** It comes with pinned submodules
  (OpenZeppelin uniswap-hooks, v4-core, v4-periphery, hookmate), so `BaseHook`
  only needed `_afterInitialize` and `_beforeSwap` overridden.
- **Dynamic fees take one flag.** Returning `fee | LPFeeLibrary.OVERRIDE_FEE_FLAG`
  from `beforeSwap` per swap is a clean design. No `updateDynamicLPFee` call
  and no extra state in the PoolManager.
- **`StateLibrary.getSlot0`** makes reading the pool's tick inside a hook a
  one-liner.
- **v4-core's test `Deployers` and `PoolSwapTest` / `PoolModifyLiquidityTest`**
  made the per-block tests (`vm.roll`) easy to write.
- **The [deployments page](https://developers.uniswap.org/contracts/v4/deployments)**
  lists PoolManager and StateView per chain, and both matched what we found
  on-chain.

### What was confusing

1. **Fee units.** Fees are in pips (1,000,000 = 100%), and the dynamic flag is
   `0x800000`, a value above `MAX_LP_FEE`. Override is `0x400000`. They live
   in one library, but the docs never put all three in one table. We first
   wrote 0.30% as `30` (bps) before switching to `3000`.
2. **Hook address mining:**
   - **Permissions in the address.** The hook's permissions are encoded in the
     low 14 bits of its address. `deployCodeTo` in tests and
     `HookMiner.find(CREATE2_FACTORY, …)` in scripts both rely on that, but
     neither error (`HookAddressNotValid`) says *which* bits were expected.
   - **Simulated scripts.** In a *simulated* `forge script` (no `--broadcast`),
     `new Hook{salt: s}()` deploys from the script contract, not from
     `CREATE2_FACTORY`. So the mined address doesn't match, and the
     constructor's `validateHookPermissions` reverts. We call the deterministic
     deployer directly (`CREATE2_FACTORY.call(salt ++ initcode)`), which works
     with and without broadcast. This deserves a line in the hook-deployment
     docs.
3. **Dynamic-fee flags at initialize.** A pool created with a static fee and a
   dynamic-fee hook silently charges the static fee unless the hook checks it.
   We revert in `afterInitialize`. PoolManager wraps the hook's revert in
   `CustomRevert.WrappedError`, so a test has to search the revert bytes to
   find the hook's own error.
4. **Template versus v4-core compiler pins.** The template pins
   `solc_version = "0.8.30"`, but v4-core's `PoolManager.sol` is `=0.8.26`. So
   importing v4-core's `test/utils/Deployers.sol` fails to compile until the pin
   is removed. Under 0.8.26, `require(cond, CustomError())` then needs via-IR,
   so we used `if (!cond) revert CustomError()`.
5. **`chainid == 31337` in the template's `Deployers`.** It deploys a fresh local
   PoolManager whenever the chain ID is 31337. On an Anvil *mainnet fork* we run
   as chain 31337, so a wallet can't confuse it with mainnet, and the helper
   then ignores the real PoolManager. We pass the deployments-page address
   explicitly.
6. **Existing pools collide.** Mainnet already has a USDC/WETH 0.30% pool at tick
   spacing 60, so initializing our comparison pool reverted with
   `PoolAlreadyInitialized` (`0x7983c051`, shown only as a raw selector in
   traces). We switched it to spacing 20.

### Docs gaps

- **A dynamic-fee page with:**
  - the three constants;
  - the fee units;
  - a note that `beforeSwap`'s third return value is ignored unless the
    override flag is set.

  Today you have to read `LPFeeLibrary.sol` and `Hooks.sol` together.
- **Hook deployment docs** should mention the simulated-script CREATE2 behaviour
  above.
- **Per-chain block times for annualizing per-block estimators.** We measured
  Unichain Sepolia (1.0 s) on-chain because we couldn't find it stated next to
  the deployment addresses.

## Arc (RiskPilotEscrow, `contracts/arc`)

- **The two-decimals model is clear in the docs.** The [contract-addresses
  reference](https://docs.arc.io/arc/references/contract-addresses.md) states
  that native USDC (gas) uses 18 decimals and the ERC-20 interface at
  `0x3600…0000` uses 6, and that they share one balance. The escrow uses only
  the ERC-20 interface.
