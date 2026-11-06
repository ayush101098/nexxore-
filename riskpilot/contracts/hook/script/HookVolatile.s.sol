// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {VolatilityFeeHook} from "../src/VolatilityFeeHook.sol";
import {DemoHookBase} from "./DemoHookBase.sol";

/// @notice make hook-volatile: a volatile spell through the existing hooked pool on the demo chain
///         (from demo/hook.json), so the fee rises toward the 1% cap and the engine re-prices the
///         gap at the new fee on the next block. VOL_BLOCKS swaps of VOL_ETH, alternating direction.
contract HookVolatile is DemoHookBase {
    using PoolIdLibrary for PoolKey;

    function run() external {
        string memory j = vm.readFile("./demo/hook.json");
        Pools memory p;
        p.hook = VolatilityFeeHook(vm.parseJsonAddress(j, ".hook"));
        p.swapRouter = PoolSwapTest(payable(vm.parseJsonAddress(j, ".swap_router")));
        p.hooked = PoolKey(Currency.wrap(USDC), Currency.wrap(WETH), LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, IHooks(address(p.hook)));
        uint256 blocks = vm.envOr("VOL_BLOCKS", uint256(6));
        uint256 ethSize = vm.envOr("VOL_ETH", uint256(4 ether));
        console.log("fee before (pips)", p.hook.getFee(p.hooked.toId()));
        vm.startBroadcast(vm.envUint("LP_PRIVATE_KEY"));
        for (uint256 i = 0; i < blocks; i++) {
            vm.roll(block.number + 1); // simulation only; on Anvil every swap is its own block
            (uint256 price,) = priceAndTick(p.hooked);
            bool ethIn = i % 2 == 0;
            swapExactIn(p, p.hooked, ethIn, ethIn ? ethSize : ethSize * price / 1e18);
        }
        vm.stopBroadcast();
        console.log("fee after (pips)", p.hook.getFee(p.hooked.toId()));
    }
}
