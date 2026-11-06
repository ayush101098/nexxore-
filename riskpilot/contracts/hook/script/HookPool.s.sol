// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";

import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {DemoHookBase} from "./DemoHookBase.sol";

/// @notice make hook-pool: deploy the hook on the demo chain and open the live pools the agent
///         quotes from: a hooked dynamic-fee USDC/WETH pool and a static 0.30% pool, both priced
///         ~0.5% from the fork's main ETH/USDC pool, with liquidity from LP_PRIVATE_KEY. Then a
///         short calm -> volatile -> calm sequence of real swaps (one per block on Anvil) gives
///         the hook an on-chain fee history. Alternating directions bring the price back.
///         Writes demo/hook.json for the engine and the /riskpilot page.
contract HookPool is DemoHookBase {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 pk = vm.envUint("LP_PRIVATE_KEY");
        vm.startBroadcast(pk);
        Pools memory p = setUpPools();
        fundPools(p, 100 ether);
        uint256 calm = 0.02 ether;
        uint256 wild = 1 ether;
        uint256[16] memory sizes = [calm, calm, calm, calm, wild, wild, wild, wild, wild, wild, calm, calm, calm, calm, calm, calm];
        for (uint256 i = 0; i < sizes.length; i++) {
            vm.roll(block.number + 1); // simulation only; on Anvil every swap is its own block
            (uint256 price,) = priceAndTick(p.hooked);
            bool ethIn = i % 2 == 0;
            swapExactIn(p, p.hooked, ethIn, ethIn ? sizes[i] : sizes[i] * price / 1e18);
        }
        vm.stopBroadcast();

        (uint256 hookedPrice, int24 tick) = priceAndTick(p.hooked);
        console.log("hook", address(p.hook));
        console.log("hooked pool price (USDC/ETH, 6 dp)", hookedPrice, "tick", vm.toString(tick));

        string memory k = "hook";
        vm.serializeAddress(k, "hook", address(p.hook));
        vm.serializeAddress(k, "pool_manager", address(POOL_MANAGER));
        vm.serializeAddress(k, "swap_router", address(p.swapRouter));
        vm.serializeBytes32(k, "hooked_pool_id", PoolId.unwrap(p.hooked.toId()));
        vm.serializeBytes32(k, "flat_pool_id", PoolId.unwrap(p.flat.toId()));
        vm.serializeBytes32(k, "main_pool_id", PoolId.unwrap(mainPoolKey().toId()));
        vm.serializeUint(k, "static_fee", STATIC_FEE);
        vm.serializeUint(k, "blocks_per_year", BLOCKS_PER_YEAR);
        vm.serializeInt(k, "main_tick", p.mainTick);
        vm.serializeInt(k, "start_tick", p.startTick);
        string memory out = vm.serializeUint(k, "deployed_block", block.number);
        vm.writeJson(out, "./demo/hook.json");
    }
}
