// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {VolatilityFeeHook} from "../src/VolatilityFeeHook.sol";

/// @notice Deploy VolatilityFeeHook to a public v4 testnet, at a mined address with its permission bits.
///         make deploy-unichain-sepolia SENDER=<your address>: signs with your own wallet (--interactive).
contract DeployHook is Script {
    function run() external {
        (IPoolManager manager, uint256 blocksPerYear) = _chain();
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory args = abi.encode(manager, blocksPerYear);
        (address expected, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(VolatilityFeeHook).creationCode, args);

        vm.startBroadcast();
        (bool ok, bytes memory ret) =
            CREATE2_FACTORY.call(abi.encodePacked(salt, type(VolatilityFeeHook).creationCode, args));
        require(ok && address(bytes20(ret)) == expected, "hook address mismatch");
        vm.stopBroadcast();

        console.log("VolatilityFeeHook", expected);
        console.log("PoolManager", address(manager));
        console.log("blocksPerYear", blocksPerYear);

        string memory k = "hook";
        vm.serializeUint(k, "chain_id", block.chainid);
        vm.serializeAddress(k, "pool_manager", address(manager));
        vm.serializeUint(k, "blocks_per_year", blocksPerYear);
        vm.serializeAddress(k, "deployer", msg.sender);
        vm.writeJson(vm.serializeAddress(k, "hook", expected), string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }

    /// @dev Addresses from https://developers.uniswap.org/contracts/v4/deployments; block times
    ///      measured on-chain (Unichain Sepolia: 1.0 s average over 1,000 blocks on 6 Nov 2026).
    function _chain() internal view returns (IPoolManager, uint256) {
        if (block.chainid == 1301) return (IPoolManager(0x00B036B58a818B1BC34d502D3fE730Db729e62AC), 31_536_000);
        if (block.chainid == 1) return (IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90), 2_628_000);
        revert("no PoolManager configured for this chain; add it from Uniswap's deployments page");
    }
}
