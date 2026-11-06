// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {VolatilityFeeHook} from "../src/VolatilityFeeHook.sol";

/// @notice Shared setup for the hook on the demo chain (Anvil fork of Ethereum mainnet).
abstract contract DemoHookBase is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Uniswap v4 Ethereum mainnet, from https://developers.uniswap.org/contracts/v4/deployments
    IPoolManager constant POOL_MANAGER = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    // Canonical mainnet tokens (USDC sorts below WETH, so USDC is currency0).
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 constant BLOCKS_PER_YEAR = 2_628_000; // Ethereum mainnet: 12 s blocks
    int24 constant TICK_SPACING = 60;
    int24 constant RANGE_TICKS = 6000; // liquidity within ~±45% of the start price
    int24 constant GAP_TICKS = 50; // ~0.5%: ln(1.005) / ln(1.0001)
    uint24 constant STATIC_FEE = 3000; // the 0.30% comparison pool
    // Mainnet already has a USDC/WETH 0.30% pool at spacing 60, so the comparison pool uses 20.
    // Liquidity ranges are multiples of 60, so both pools get identical positions.
    int24 constant FLAT_TICK_SPACING = 20;

    struct Pools {
        VolatilityFeeHook hook;
        PoolSwapTest swapRouter;
        PoolModifyLiquidityTest liquidityRouter;
        PoolKey hooked;
        PoolKey flat;
        int24 mainTick;
        int24 startTick;
    }

    /// @notice The fork's main ETH/USDC v4 pool (native ETH, 0.05%, spacing 10, no hook).
    function mainPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(USDC), 500, 10, IHooks(address(0)));
    }

    /// @notice USDC (6 dp) per ETH at a USDC/WETH pool's sqrt price.
    function usdcPerEth(uint160 sqrtPriceX96) internal pure returns (uint256) {
        return FullMath.mulDiv(FullMath.mulDiv(1e18, 1 << 96, sqrtPriceX96), 1 << 96, sqrtPriceX96);
    }

    function deployHook() internal returns (VolatilityFeeHook hook) {
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory args = abi.encode(POOL_MANAGER, BLOCKS_PER_YEAR);
        (address expected, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(VolatilityFeeHook).creationCode, args);
        // Call the deterministic deployer directly: `new X{salt}` only routes through it when
        // broadcasting, so a simulated run would deploy from the script address and miss.
        (bool ok, bytes memory ret) =
            CREATE2_FACTORY.call(abi.encodePacked(salt, type(VolatilityFeeHook).creationCode, args));
        require(ok && address(bytes20(ret)) == expected, "hook address mismatch");
        hook = VolatilityFeeHook(expected);
    }

    /// @notice Hooked dynamic-fee pool and a static 0.30% pool, both USDC/WETH, both priced
    ///         GAP_TICKS (~0.5%) above the fork's main ETH/USDC pool, each with the same liquidity.
    /// @dev Deploys and initializes; call fundPools from the LP's context afterwards.
    function setUpPools() internal returns (Pools memory p) {
        (, p.mainTick,,) = POOL_MANAGER.getSlot0(mainPoolKey().toId());
        // Main pool prices USDC per ETH; ours prices WETH per USDC, so the tick flips sign.
        // ETH 0.5% dearer here means 0.5% fewer WETH per USDC: GAP_TICKS lower.
        p.startTick = -p.mainTick - GAP_TICKS;

        p.hook = deployHook();
        p.swapRouter = new PoolSwapTest(POOL_MANAGER);
        p.liquidityRouter = new PoolModifyLiquidityTest(POOL_MANAGER);
        Currency c0 = Currency.wrap(USDC);
        Currency c1 = Currency.wrap(WETH);
        p.hooked = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, IHooks(address(p.hook)));
        p.flat = PoolKey(c0, c1, STATIC_FEE, FLAT_TICK_SPACING, IHooks(address(0)));

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(p.startTick);
        POOL_MANAGER.initialize(p.hooked, sqrtPrice);
        POOL_MANAGER.initialize(p.flat, sqrtPrice);
    }

    /// @notice Approve the routers and add the same liquidity to both pools, as msg.sender.
    function fundPools(Pools memory p, uint256 wethPerPool) internal {
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(p.startTick);
        IERC20(USDC).approve(address(p.liquidityRouter), type(uint256).max);
        IERC20(WETH).approve(address(p.liquidityRouter), type(uint256).max);
        IERC20(USDC).approve(address(p.swapRouter), type(uint256).max);
        IERC20(WETH).approve(address(p.swapRouter), type(uint256).max);
        _addLiquidity(p, p.hooked, sqrtPrice, wethPerPool);
        _addLiquidity(p, p.flat, sqrtPrice, wethPerPool);
    }

    function _addLiquidity(Pools memory p, PoolKey memory key, uint160 sqrtPrice, uint256 weth) private {
        int24 center = p.startTick / TICK_SPACING * TICK_SPACING;
        int24 lower = center - RANGE_TICKS;
        int24 upper = center + RANGE_TICKS;
        uint256 usdc = weth * usdcPerEth(sqrtPrice) / 1e18;
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPrice, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), usdc, weth
        );
        p.liquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: 0}), ""
        );
    }

    /// @notice Exact-in swap. ethIn: sell `amount` WETH; otherwise sell `amount` USDC.
    function swapExactIn(Pools memory p, PoolKey memory key, bool ethIn, uint256 amount)
        internal
        returns (BalanceDelta delta)
    {
        // currency0 = USDC: selling USDC is zeroForOne.
        bool zeroForOne = !ethIn;
        delta = p.swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function priceAndTick(PoolKey memory key) internal view returns (uint256 price, int24 tick) {
        uint160 sqrtPrice;
        (sqrtPrice, tick,,) = POOL_MANAGER.getSlot0(key.toId());
        price = usdcPerEth(sqrtPrice);
    }
}
