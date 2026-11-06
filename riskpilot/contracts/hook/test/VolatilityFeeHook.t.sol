// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

import {VolatilityFeeHook} from "../src/VolatilityFeeHook.sol";

contract VolatilityFeeHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for *;

    uint256 constant BLOCKS_PER_YEAR = 2_628_000; // 12 s blocks (Ethereum mainnet / the demo fork)
    bytes32 constant FEE_UPDATED = keccak256("FeeUpdated(bytes32,uint256,uint24)");

    VolatilityFeeHook hook;
    PoolId id;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        // Hook permissions live in the address bits; deploy the code at an address with exactly those flags.
        address flags = address(uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) ^ (0x4444 << 144));
        deployCodeTo("VolatilityFeeHook.sol:VolatilityFeeHook", abi.encode(manager, BLOCKS_PER_YEAR), flags);
        hook = VolatilityFeeHook(flags);

        key = PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        id = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1000e18, salt: 0}), ZERO_BYTES
        );
    }

    function _swapNextBlock(bool zeroForOne, uint256 amountIn) internal {
        vm.roll(block.number + 1);
        swap(key, zeroForOne, -int256(amountIn), ZERO_BYTES);
    }

    function _tick() internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(id);
    }

    function _feeUpdates(Vm.Log[] memory logs) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == FEE_UPDATED) n++;
        }
    }

    // ── the five PRD 4 tests ──────────────────────────────────────────────

    /// Low volatility: small swaps across blocks keep the fee near the 500 floor.
    function test_LowVolatilityKeepsFeeNearFloor() public {
        for (uint256 i = 0; i < 20; i++) {
            _swapNextBlock(i % 2 == 0, 0.005e18);
        }
        _swapNextBlock(true, 0.005e18); // reads the last block's move
        uint24 fee = hook.getFee(id);
        assertGe(fee, hook.MIN_FEE());
        // Ticks are integers: tiny swaps here flip the tick between 0 and -1, a 1-tick (0.01%)
        // return in some blocks. That quantization floor keeps the fee a little above 500.
        assertLe(fee, 700, "fee stays near 500");
        emit log_named_uint("low-vol fee (pips)", fee);
        emit log_named_decimal_uint("low-vol sigma_ann", hook.getVolatility(id), 18);
    }

    /// High volatility: large swaps with vm.roll between blocks push the fee up, never above 10,000.
    function test_HighVolatilityRaisesFeeWithinCap() public {
        uint24 prev = hook.getFee(id);
        bool rose;
        for (uint256 i = 0; i < 12; i++) {
            _swapNextBlock(i % 2 == 0, 40e18);
            uint24 fee = hook.getFee(id);
            assertLe(fee, hook.MAX_FEE(), "never above the cap");
            if (fee > prev) rose = true;
            prev = fee;
        }
        assertTrue(rose, "fee rose");
        assertEq(hook.getFee(id), hook.MAX_FEE(), "sustained 2%-per-block moves reach the cap");
    }

    /// Two swaps in one block: only the first one updates the estimator.
    function test_TwoSwapsInOneBlockUpdateOnce() public {
        _swapNextBlock(true, 10e18); // moves the price; measured at the next block's first swap
        vm.roll(block.number + 1);
        vm.recordLogs();
        swap(key, false, -10e18, ZERO_BYTES);
        swap(key, true, -10e18, ZERO_BYTES);
        assertEq(_feeUpdates(vm.getRecordedLogs()), 1, "one estimator update per block");
        (,, uint24 fee,,) = hook.volState(id);
        (, uint64 lastBlock,,,) = hook.volState(id);
        assertEq(lastBlock, block.number);
        assertEq(fee, hook.getFee(id));
    }

    /// A tick jump beyond 200 is capped at 200 ticks (~2%) in the return.
    function test_TickJumpIsCappedAt200() public {
        _swapNextBlock(true, 200e18); // big move; first update of this block saw Δtick = 0
        int24 jumped = _tick();
        assertGt(uint256(int256(-jumped)), 200, "the move really exceeded 200 ticks");

        _swapNextBlock(false, 0.001e18); // this block's first swap measures the jump
        uint256 r = 200 * hook.LN_1_0001_WAD();
        uint256 variance = (1e18 - hook.BETA_WAD()) * (r * r / 1e18) / 1e18; // from v = 0 over one block
        uint256 expected = Math.sqrt(variance * BLOCKS_PER_YEAR * 1e18);
        assertEq(hook.getVolatility(id), expected, "sigma uses the capped 200-tick return");
    }

    /// A pool with a static fee cannot be initialized with this hook.
    function test_NonDynamicFeePoolCannotInitialize() public {
        PoolKey memory staticKey = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        // PoolManager wraps hook reverts (CustomRevert.WrappedError); the hook's reason is inside.
        try manager.initialize(staticKey, SQRT_PRICE_1_1) {
            fail();
        } catch (bytes memory err) {
            bytes4 reason = VolatilityFeeHook.MustUseDynamicFee.selector;
            bool found;
            for (uint256 i = 0; i + 4 <= err.length; i++) {
                if (err[i] == reason[0] && err[i + 1] == reason[1] && err[i + 2] == reason[2] && err[i + 3] == reason[3]) {
                    found = true;
                }
            }
            assertTrue(found, "reverted with MustUseDynamicFee");
        }
    }

    // ── fee rule ──────────────────────────────────────────────────────────

    function test_FeeRule() public view {
        assertEq(hook.feeForSigma(0), 500, "0.05% at zero volatility");
        assertEq(hook.feeForSigma(0.5e18), 3000, "0.30% at 50% volatility");
        assertEq(hook.feeForSigma(1.9e18), 10_000, "1.00% at 190%");
        assertEq(hook.feeForSigma(5e18), 10_000, "capped");
    }
}
