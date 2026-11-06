// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {DemoHookBase} from "./DemoHookBase.sol";

interface IWETH {
    function deposit() external payable;
}

/// @notice make hook-demo: the same swap sequence through the hooked pool and a static 0.30%
///         pool, on the demo chain's state (simulated; nothing is broadcast). Calm, normal,
///         volatile, then calm again, one swap per block. Prints the fee per block and each
///         pool's LP fee income.
contract HookDemo is DemoHookBase {
    using PoolIdLibrary for PoolKey;

    // Large USDC holder at the pinned block, found by contracts/aqua/script/find_usdc_holder.py.
    address constant USDC_HOLDER = 0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341;

    uint256 hookIncome; // LP fee income, USDC 6 dp
    uint256 flatIncome;

    function run() external {
        Pools memory p = setUpPools();

        // One simulated account provides the liquidity and makes every trade.
        address trader = vm.addr(0xA11CE);
        vm.deal(trader, 2_000 ether);
        vm.prank(USDC_HOLDER);
        IERC20(USDC).transfer(trader, 5_000_000e6);
        vm.startPrank(trader);
        IWETH(WETH).deposit{value: 1_500 ether}();
        fundPools(p, 400 ether); // ~$0.9M per pool within ±45% of the start price
        (uint256 start,) = priceAndTick(p.hooked);
        console.log("Demo chain block", block.number);
        console.log("hooked pool start price (USDC/ETH):", _usd(start));
        console.log("main ETH/USDC pool tick", vm.toString(p.mainTick), "-> hooked pool start tick", vm.toString(p.startTick));
        console.log("");
        console.log("phase       block   trade              tick    sigma_ann   hook fee   flat fee   hook fee paid   flat fee paid");

        // Alternating buys and sells, one per block. Per-block moves of ~1, ~3 and ~50 ticks are
        // roughly 16%, 50% and 800% annualized at 12 s blocks.
        _phase(p, "calm      ", 8, 0.08 ether);
        _phase(p, "normal    ", 8, 0.25 ether);
        _phase(p, "volatile  ", 8, 4 ether);
        _phase(p, "calm again", 16, 0.08 ether);
        vm.stopPrank();

        console.log("");
        console.log("LP fee income, hooked pool (USD):", _usd(hookIncome));
        console.log("LP fee income, static 0.30% pool (USD):", _usd(flatIncome));
    }

    function _phase(Pools memory p, string memory name, uint256 blocks, uint256 ethSize) internal {
        for (uint256 i = 0; i < blocks; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            bool ethIn = i % 2 == 0;
            (uint256 price,) = priceAndTick(p.hooked);
            uint256 amount = ethIn ? ethSize : ethSize * price / 1e18; // same USD size both ways
            uint256 sizeUsd = ethSize * price / 1e18;

            swapExactIn(p, p.hooked, ethIn, amount);
            uint24 hookFee = p.hook.getFee(p.hooked.toId());
            swapExactIn(p, p.flat, ethIn, amount);

            uint256 hookPaid = sizeUsd * hookFee / 1e6;
            uint256 flatPaid = sizeUsd * STATIC_FEE / 1e6;
            hookIncome += hookPaid;
            flatIncome += flatPaid;

            _row(p, name, ethIn, ethSize, hookFee, hookPaid, flatPaid);
        }
    }

    function _row(
        Pools memory p,
        string memory name,
        bool ethIn,
        uint256 ethSize,
        uint24 hookFee,
        uint256 hookPaid,
        uint256 flatPaid
    ) internal view {
        (, int24 tick) = priceAndTick(p.hooked);
        string memory left = string.concat(
            name, "  ", vm.toString(block.number), "  ", ethIn ? "sell " : "buy  ", _eth(ethSize), " ETH  ", vm.toString(tick)
        );
        string memory right = string.concat(
            _pct(p.hook.getVolatility(p.hooked.toId())), "    ", _bps(hookFee), "     ", _bps(STATIC_FEE), "      ",
            _usd(hookPaid), "          ", _usd(flatPaid)
        );
        console.log(string.concat(left, "   ", right));
    }

    // ── formatting ──────────────────────────────────────────────────────────
    function _dec(uint256 v, uint256 scale, uint256 places) internal pure returns (string memory) {
        uint256 whole = v / scale;
        uint256 frac = (v % scale) * 10 ** places / scale;
        bytes memory f = bytes(vm.toString(frac));
        while (f.length < places) f = abi.encodePacked("0", f);
        return string.concat(vm.toString(whole), ".", string(f));
    }

    function _usd(uint256 usdc6) internal pure returns (string memory) {
        return _dec(usdc6, 1e6, 2);
    }

    function _eth(uint256 wei_) internal pure returns (string memory) {
        return _dec(wei_, 1e18, 2);
    }

    function _pct(uint256 wad) internal pure returns (string memory) {
        return string.concat(_dec(wad * 100, 1e18, 1), "%");
    }

    function _bps(uint24 pips) internal pure returns (string memory) {
        return string.concat(_dec(uint256(pips), 1e4, 3), "%");
    }
}
