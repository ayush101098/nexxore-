// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";

import { DemoParams } from "../src/DemoParams.sol";

/// @notice Scripted taker for the demo chain. CURVE=upside buys ETH from the call-like curve
///         with USDC (AMOUNT, 6 dp); CURVE=downside sells ETH (AMOUNT, 18 dp) to the put-like
///         curve. Reads demo/curves.json, prints balances before and after.
contract TakeDemoFill is Script {
    function run() external {
        address taker = vm.envAddress("TAKER"); // impersonated on the fork (--unlocked)
        string memory curve = vm.envOr("CURVE", string("upside"));
        bool upside = keccak256(bytes(curve)) == keccak256("upside");
        uint256 amount = vm.envOr("AMOUNT", upside ? uint256(1_500e6) : uint256(0.4 ether));

        string memory json = vm.readFile("./demo/curves.json");
        address maker = vm.parseJsonAddress(json, ".maker");
        ISwapVM.Order memory order =
            abi.decode(vm.parseJsonBytes(json, string.concat(".", curve, ".order")), (ISwapVM.Order));
        bytes32 h = vm.parseJsonBytes32(json, string.concat(".", curve, ".strategy_hash"));
        (address tokenIn, address tokenOut) =
            upside ? (DemoParams.USDC, DemoParams.WETH) : (DemoParams.WETH, DemoParams.USDC);

        bytes memory takerData = _takerData(taker);
        // Quote ignores the curve's real balances: cap it before trading (contracts/aqua/README.md).
        (, uint256 quoted,) = ISwapVM(DemoParams.ROUTER).quote(order, tokenIn, tokenOut, amount, takerData);
        (uint256 balWeth, uint256 balUsdc) =
            IAqua(DemoParams.AQUA).safeBalances(maker, DemoParams.ROUTER, h, DemoParams.WETH, DemoParams.USDC);
        uint256 fillable = tokenOut == DemoParams.WETH ? balWeth : balUsdc;
        require(quoted <= fillable, "quote exceeds the curve's real balance");

        _log("before", maker, taker);
        vm.startBroadcast(taker);
        IERC20(tokenIn).approve(DemoParams.ROUTER, amount);
        (uint256 amountIn, uint256 amountOut,) = ISwapVM(DemoParams.ROUTER).swap(order, tokenIn, tokenOut, amount, takerData);
        vm.stopBroadcast();
        _log("after", maker, taker);
        console.log("curve    ", curve);
        console.log("amountIn ", amountIn);
        console.log("amountOut", amountOut);
    }

    function _takerData(address taker) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }

    function _log(string memory label, address maker, address taker) internal view {
        console.log(label);
        console.log("  maker WETH", IERC20(DemoParams.WETH).balanceOf(maker), "USDC", IERC20(DemoParams.USDC).balanceOf(maker));
        console.log("  taker WETH", IERC20(DemoParams.WETH).balanceOf(taker), "USDC", IERC20(DemoParams.USDC).balanceOf(taker));
    }
}
