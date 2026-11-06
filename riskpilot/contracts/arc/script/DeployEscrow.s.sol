// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RiskPilotEscrow} from "../src/RiskPilotEscrow.sol";

/// @notice Deploy RiskPilotEscrow on Arc testnet (chain 5042002) and write deployments/arc-testnet.json.
///         OPERATOR_ADDRESS defaults to the deployer. `make arc-deploy` adds the deploy tx hash.
///         Rehearsal: ARC_REHEARSAL=true with ARC_USDC=<6-decimal mock> deploys to any chain and
///         writes ARC_DEPLOYMENT_OUT instead.
contract DeployEscrow is Script {
    // Arc testnet USDC ERC-20 interface, 6 decimals (docs.arc.io/arc/references/contract-addresses).
    IERC20 constant ARC_USDC = IERC20(0x3600000000000000000000000000000000000000);

    function run() external {
        bool rehearsal = vm.envOr("ARC_REHEARSAL", false);
        require(block.chainid == 5042002 || rehearsal, "not Arc testnet");
        IERC20 usdc = rehearsal ? IERC20(vm.envAddress("ARC_USDC")) : ARC_USDC;
        address operator = vm.envOr("OPERATOR_ADDRESS", msg.sender);
        vm.startBroadcast();
        RiskPilotEscrow escrow = new RiskPilotEscrow(usdc, operator);
        vm.stopBroadcast();
        console.log("RiskPilotEscrow", address(escrow));
        console.log("operator", operator);

        string memory k = "arc";
        vm.serializeUint(k, "chain_id", block.chainid);
        vm.serializeAddress(k, "usdc", address(usdc));
        vm.serializeUint(k, "usdc_decimals", 6);
        vm.serializeAddress(k, "operator", operator);
        vm.serializeUint(k, "deployed_block", block.number);
        vm.serializeString(k, "explorer", "https://explorer.testnet.arc.io");
        string memory out = vm.envOr("ARC_DEPLOYMENT_OUT", string("./deployments/arc-testnet.json"));
        vm.writeJson(vm.serializeAddress(k, "escrow", address(escrow)), out);
    }
}
