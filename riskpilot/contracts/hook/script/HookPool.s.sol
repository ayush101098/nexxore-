// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";

import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {DemoHookBase} from "./DemoHookBase.sol";

/// @notice make hook-pool: deploy the hook on the demo chain and open the live pools the agent
///         quotes from: a hooked dynamic-fee USDC/WETH pool and a static 0.30% pool, both priced
///         ~0.5% from the fork's main ETH/USDC pool, with liquidity from the LP address (impersonated on the fork). Then a
///         calm -> volatile -> long calm sequence of real swaps (one per block on Anvil) gives the
///         hook an on-chain fee history that rises and falls back. Alternating directions bring the
///         price back.
///         Writes demo/hook.json for the engine and the /riskpilot page.
contract HookPool is DemoHookBase {
    using PoolIdLibrary for PoolKey;

    function run() external {
        vm.startBroadcast(vm.envAddress("LP"));
        Pools memory p = setUpPools();
        // Deep enough to trade a $10k gap through (~1,000 WETH per pool within ±45% of the price).
        fundPools(p, 1_000 ether);
        // On-chain fee history: calm, then a volatile spell, then a long calm tail so the EWMA
        // (beta 0.94, half-life ~11 blocks) brings the fee back down. Per-block moves of ~1 tick
        // (calm) and ~20 ticks (volatile). Alternating directions bring the price back.
        _phase(p, 8, 0.2 ether);
        _phase(p, 6, 4 ether);
        _phase(p, 60, 0.2 ether);
        vm.stopBroadcast();

        (uint256 hookedPrice, int24 tick) = priceAndTick(p.hooked);
        console.log("hook", address(p.hook));
        console.log("hooked pool price (USDC/ETH, 6 dp)", hookedPrice, "tick", vm.toString(tick));

        string memory k = "hook";
        vm.serializeUint(k, "fee_now", p.hook.getFee(p.hooked.toId()));
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

    function _phase(Pools memory p, uint256 blocks, uint256 ethSize) internal {
        for (uint256 i = 0; i < blocks; i++) {
            vm.roll(block.number + 1); // simulation only; on Anvil every swap is its own block
            (uint256 price,) = priceAndTick(p.hooked);
            bool ethIn = i % 2 == 0;
            swapExactIn(p, p.hooked, ethIn, ethIn ? ethSize : ethSize * price / 1e18);
        }
    }
}
