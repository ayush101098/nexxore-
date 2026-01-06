// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseVault.sol";

/**
 * @title VaultFactory
 * @notice Factory contract for deploying vault instances
 * @dev Deploys full BaseVault contracts (not proxies)
 */
contract VaultFactory is Ownable {
    // ============ State Variables ============

    /// @notice Array of all deployed vault addresses
    address[] public allVaults;

    /// @notice Mapping to check if an address is a valid vault
    mapping(address => bool) public isVault;

    /// @notice Mapping from vault address to metadata
    mapping(address => VaultMetadata) public vaultMetadata;

    // ============ Structs ============

    struct VaultMetadata {
        string name;
        string symbol;
        address asset;
        address creator;
        uint256 createdAt;
        bool active;
    }

    // ============ Events ============

    event VaultCreated(
        address indexed vault,
        address indexed creator,
        address indexed asset,
        string name,
        string symbol,
        uint256 timestamp
    );

    event VaultDeactivated(address indexed vault, uint256 timestamp);

    // ============ Errors ============

    error InvalidAsset();
    error VaultNotFound();
    error VaultAlreadyDeactivated();

    // ============ Constructor ============

    /**
     * @notice Initializes the factory
     */
    constructor() Ownable(msg.sender) {}

    // ============ External Functions ============

    /**
     * @notice Deploys a new vault
     * @param asset The underlying asset token address
     * @param name Vault share token name
     * @param symbol Vault share token symbol
     * @param strategies Initial array of strategy addresses
     * @param weights Initial capital allocation weights (basis points, sum should be 10000)
     * @return vault Address of the newly created vault
     */
    function createVault(
        address asset,
        string memory name,
        string memory symbol,
        address[] memory strategies,
        uint256[] memory weights
    ) external returns (address vault) {
        if (asset == address(0)) revert InvalidAsset();

        // Deploy new BaseVault instance
        BaseVault newVault = new BaseVault(
            IERC20(asset),
            name,
            symbol,
            msg.sender,
            strategies,
            weights
        );

        vault = address(newVault);

        // Store vault metadata
        vaultMetadata[vault] = VaultMetadata({
            name: name,
            symbol: symbol,
            asset: asset,
            creator: msg.sender,
            createdAt: block.timestamp,
            active: true
        });

        // Register vault
        allVaults.push(vault);
        isVault[vault] = true;

        emit VaultCreated(
            vault,
            msg.sender,
            asset,
            name,
            symbol,
            block.timestamp
        );
    }

    /**
     * @notice Deactivates a vault (only owner can call)
     * @param vault Address of the vault to deactivate
     */
    function deactivateVault(address vault) external onlyOwner {
        if (!isVault[vault]) revert VaultNotFound();
        if (!vaultMetadata[vault].active) revert VaultAlreadyDeactivated();

        vaultMetadata[vault].active = false;
        emit VaultDeactivated(vault, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @notice Returns the total number of vaults created
     */
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /**
     * @notice Returns all vault addresses
     */
    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }

    /**
     * @notice Returns active vaults only
     */
    function getActiveVaults() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active vaults
        for (uint256 i = 0; i < allVaults.length; i++) {
            if (vaultMetadata[allVaults[i]].active) {
                activeCount++;
            }
        }

        // Build array of active vaults
        address[] memory activeVaults = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allVaults.length; i++) {
            if (vaultMetadata[allVaults[i]].active) {
                activeVaults[index] = allVaults[i];
                index++;
            }
        }

        return activeVaults;
    }

    /**
     * @notice Returns vaults created by a specific address
     * @param creator Address of the vault creator
     */
    function getVaultsByCreator(address creator) external view returns (address[] memory) {
        uint256 count = 0;
        
        // Count vaults by creator
        for (uint256 i = 0; i < allVaults.length; i++) {
            if (vaultMetadata[allVaults[i]].creator == creator) {
                count++;
            }
        }

        // Build array
        address[] memory creatorVaults = new address[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allVaults.length; i++) {
            if (vaultMetadata[allVaults[i]].creator == creator) {
                creatorVaults[index] = allVaults[i];
                index++;
            }
        }

        return creatorVaults;
    }

    /**
     * @notice Returns full metadata for a vault
     * @param vault Address of the vault
     */
    function getVaultMetadata(address vault) external view returns (VaultMetadata memory) {
        if (!isVault[vault]) revert VaultNotFound();
        return vaultMetadata[vault];
    }
}
