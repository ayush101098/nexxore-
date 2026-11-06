// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RiskPilotEscrow} from "../src/RiskPilotEscrow.sol";

/// @notice Deploy RiskPilotEscrow on Arc testnet (chain 5042002) and write deployments/arc-testnet.json.
///         OPERATOR_ADDRESS defaults to the deployer.
contract DeployEscrow is Script {
    // Arc testnet USDC ERC-20 interface, 6 decimals (docs.arc.io/arc/references/contract-addresses).
    IERC20 constant ARC_USDC = IERC20(0x3600000000000000000000000000000000000000);

    function run() external {
        require(block.chainid == 5042002, "not Arc testnet");
        address operator = vm.envOr("OPERATOR_ADDRESS", msg.sender);
        vm.startBroadcast();
        RiskPilotEscrow escrow = new RiskPilotEscrow(ARC_USDC, operator);
        vm.stopBroadcast();
        console.log("RiskPilotEscrow", address(escrow));
        console.log("operator", operator);

        string memory k = "arc";
        vm.serializeUint(k, "chain_id", block.chainid);
        vm.serializeAddress(k, "usdc", address(ARC_USDC));
        vm.serializeAddress(k, "operator", operator);
        vm.serializeUint(k, "deployed_block", block.number);
        vm.serializeString(k, "explorer", "https://explorer.testnet.arc.io");
        vm.writeJson(vm.serializeAddress(k, "escrow", address(escrow)), "./deployments/arc-testnet.json");
    }
}
