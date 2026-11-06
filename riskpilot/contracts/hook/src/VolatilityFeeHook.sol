// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title VolatilityFeeHook
/// @notice Sets a dynamic-fee pool's swap fee from the pool's own realized volatility, inside
///         fixed bounds, with no external oracle.
///
///         Once per block, on the first swap, it reads the pool tick and takes the log return
///         since the last update, r = Δtick · ln(1.0001), with |Δtick| capped at 200 (~2%).
///         It updates an EWMA of squared per-block returns,
///             v_t = β v_{t-1} + (1 − β) r_t²,   σ_ann = sqrt(v_t · N_blocks/yr),
///         and sets  fee = clamp(500 + 5,000 · σ_ann, 500, 10,000) pips (1,000,000 = 100%):
///         0.05% at zero volatility, ~0.30% at 50%, capped at 1.00%.
///
///         When Δ blocks have passed since the last update, the return spans Δ blocks, so it
///         is spread evenly over them and the EWMA decays by β^Δ:
///             v_t = β^Δ v_{t-1} + (1 − β^Δ) r_t² / Δ        (Δ = 1 gives the formula above).
///
///         Manipulation: several swaps in one block cannot move the estimate, so pushing the
///         fee up means holding the price away across blocks and paying the fee to do it.
contract VolatilityFeeHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using LPFeeLibrary for uint24;

    uint256 internal constant WAD = 1e18;
    /// @dev ln(1.0001) in WAD: 0.000099995000333308...
    uint256 public constant LN_1_0001_WAD = 99_995_000_333_308;
    uint256 public constant BETA_WAD = 0.94e18;
    uint256 public constant TICK_CAP = 200;
    /// @dev Beyond this many blocks β^Δ is below 4e-4, so older history is treated as gone.
    uint256 internal constant MAX_DECAY_BLOCKS = 128;

    uint24 public constant MIN_FEE = 500; // 0.05%
    uint24 public constant MAX_FEE = 10_000; // 1.00%
    uint256 public constant FEE_PER_SIGMA = 5_000; // pips per 1.0 (100%) of annualized vol

    /// @notice Blocks per year on the chain this hook serves (e.g. 2,628,000 for 12 s blocks).
    uint256 public immutable blocksPerYear;

    struct VolState {
        int24 lastTick;
        uint64 lastBlock;
        uint24 fee;
        uint256 variance; // per-block variance of log returns, WAD
        uint256 sigma; // annualized volatility, WAD (1e18 = 100%)
    }

    mapping(PoolId => VolState) public volState;

    event FeeUpdated(PoolId indexed poolId, uint256 sigma, uint24 fee);

    error MustUseDynamicFee();
    error ZeroBlocksPerYear();

    constructor(IPoolManager _poolManager, uint256 _blocksPerYear) BaseHook(_poolManager) {
        if (_blocksPerYear == 0) revert ZeroBlocksPerYear();
        blocksPerYear = _blocksPerYear;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Annualized volatility estimate for a pool, WAD (1e18 = 100%).
    function getVolatility(PoolId poolId) external view returns (uint256) {
        return volState[poolId].sigma;
    }

    /// @notice The fee the next swap in a new block starts from, in pips.
    function getFee(PoolId poolId) external view returns (uint24) {
        return volState[poolId].fee;
    }

    /// @notice fee = clamp(500 + 5,000 · σ_ann, 500, 10,000) pips, σ_ann in WAD.
    function feeForSigma(uint256 sigmaWad) public pure returns (uint24) {
        uint256 fee = MIN_FEE + FEE_PER_SIGMA * sigmaWad / WAD;
        return fee > MAX_FEE ? MAX_FEE : uint24(fee);
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24 tick) internal override returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert MustUseDynamicFee();
        volState[key.toId()] =
            VolState({lastTick: tick, lastBlock: uint64(block.number), fee: MIN_FEE, variance: 0, sigma: 0});
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        VolState storage s = volState[id];
        if (block.number > s.lastBlock) {
            (, int24 tick,,) = poolManager.getSlot0(id);
            _update(id, s, tick);
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, s.fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev The once-per-block estimator: capped tick return -> EWMA variance -> σ_ann -> fee.
    function _update(PoolId id, VolState storage s, int24 tick) internal {
        uint256 elapsed = block.number - s.lastBlock;
        int256 dTick = int256(tick) - int256(s.lastTick);
        uint256 absTick = uint256(dTick < 0 ? -dTick : dTick);
        if (absTick > TICK_CAP) absTick = TICK_CAP;

        uint256 r = absTick * LN_1_0001_WAD; // |log return|, WAD
        uint256 r2PerBlock = r * r / WAD / elapsed; // squared return spread over the elapsed blocks

        uint256 decay = WAD; // β^Δ
        uint256 steps = elapsed < MAX_DECAY_BLOCKS ? elapsed : MAX_DECAY_BLOCKS;
        for (uint256 i = 0; i < steps; i++) {
            decay = decay * BETA_WAD / WAD;
        }
        if (elapsed >= MAX_DECAY_BLOCKS) decay = 0;

        uint256 variance = (decay * s.variance + (WAD - decay) * r2PerBlock) / WAD;
        uint256 sigma = Math.sqrt(variance * blocksPerYear * WAD); // sqrt(WAD · N) in WAD
        uint24 fee = feeForSigma(sigma);

        s.lastTick = tick;
        s.lastBlock = uint64(block.number);
        s.variance = variance;
        s.sigma = sigma;
        s.fee = fee;
        emit FeeUpdated(id, sigma, fee);
    }
}
