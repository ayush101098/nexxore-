// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { AquaCollateral } from "../src/AquaCollateral.sol";
import { AquaCurves } from "../src/AquaCurves.sol";
import { DemoParams } from "../src/DemoParams.sol";

/// @notice Ships both demo curves (w = 1.275) from MAKER_PRIVATE_KEY's wallet on the demo
///         chain, after the per-token collateral check, and writes demo/curves.json.
contract ShipDemoCurves is Script, AquaCurves {
    constructor() AquaCurves(DemoParams.AQUA, DemoParams.WETH, DemoParams.USDC) { }

    function run() external {
        uint256 pk = vm.envUint("MAKER_PRIVATE_KEY");
        address maker = vm.addr(pk);

        Curve memory up =
            upsideCurve(maker, DemoParams.SPOT, DemoParams.WIDTH_BPS, DemoParams.CALL_ETH, DemoParams.UPSIDE_FEE);
        Curve memory down =
            downsideCurve(maker, DemoParams.SPOT, DemoParams.WIDTH_BPS, DemoParams.PUT_USDC, DemoParams.DOWNSIDE_FEE);

        vm.startBroadcast(pk);
        IERC20(WETH).approve(DemoParams.AQUA, type(uint256).max);
        IERC20(USDC).approve(DemoParams.AQUA, type(uint256).max);

        // Refuse to ship if the two curves promise more of a token than the wallet can cover.
        AquaCollateral.Shipment[] memory plan = new AquaCollateral.Shipment[](2);
        plan[0] = AquaCollateral.Shipment(up.tokens, up.amounts);
        plan[1] = AquaCollateral.Shipment(down.tokens, down.amounts);
        AquaCollateral.check(plan, maker, DemoParams.AQUA);

        bytes32 hUp = IAqua(DemoParams.AQUA).ship(DemoParams.ROUTER, abi.encode(up.order), up.tokens, up.amounts);
        bytes32 hDown =
            IAqua(DemoParams.AQUA).ship(DemoParams.ROUTER, abi.encode(down.order), down.tokens, down.amounts);
        vm.stopBroadcast();

        console.log("maker", maker);
        console.log("upside   strategy", vm.toString(hUp));
        console.log("downside strategy", vm.toString(hDown));

        string memory root = "curves";
        vm.serializeAddress(root, "maker", maker);
        vm.serializeAddress(root, "router", DemoParams.ROUTER);
        vm.serializeAddress(root, "aqua", DemoParams.AQUA);
        vm.serializeUint(root, "fork_block", vm.envOr("AQUA_FORK_BLOCK", DemoParams.FORK_BLOCK));
        vm.serializeString(root, "upside", _curveJson("upside", "call_like", up, hUp, DemoParams.UPSIDE_FEE));
        string memory out =
            vm.serializeString(root, "downside", _curveJson("downside", "put_like", down, hDown, DemoParams.DOWNSIDE_FEE));
        vm.writeJson(out, "./demo/curves.json");
    }

    function _curveJson(string memory key, string memory side, Curve memory c, bytes32 h, uint32 fee)
        internal
        returns (string memory)
    {
        vm.serializeString(key, "side", side);
        vm.serializeBytes32(key, "strategy_hash", h);
        vm.serializeBytes(key, "order", abi.encode(c.order));
        vm.serializeUint(key, "range_low_usdc", c.range.lowUsdc);
        vm.serializeUint(key, "range_high_usdc", c.range.highUsdc);
        vm.serializeUint(key, "equivalent_strike_usdc", equivalentStrike(c.range));
        vm.serializeUint(key, "fee_instruction", fee);
        vm.serializeUint(key, "weth_amount", c.amounts[0]);
        return vm.serializeUint(key, "usdc_amount", c.amounts[1]);
    }
}
