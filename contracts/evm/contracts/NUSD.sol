// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title nUSD - Nexxore Synthetic Dollar
 * @notice Overcollateralized stablecoin backed by hedged crypto positions
 * @dev Only CollateralManager can mint/burn
 */
contract NUSD is ERC20, ERC20Burnable, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Collateral manager contract
    address public collateralManager;

    // Events
    event CollateralManagerUpdated(address indexed oldManager, address indexed newManager);

    constructor() ERC20("Nexxore USD", "nUSD") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /**
     * @notice Set the collateral manager contract
     * @param _manager Address of CollateralManager
     */
    function setCollateralManager(address _manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_manager != address(0), "Invalid address");
        
        address oldManager = collateralManager;
        
        // Revoke old manager
        if (oldManager != address(0)) {
            _revokeRole(MINTER_ROLE, oldManager);
        }
        
        // Set new manager
        collateralManager = _manager;
        _grantRole(MINTER_ROLE, _manager);
        
        emit CollateralManagerUpdated(oldManager, _manager);
    }

    /**
     * @notice Mint nUSD tokens
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        _mint(to, amount);
    }

    /**
     * @notice Burn nUSD tokens from caller
     * @param amount Amount to burn
     */
    function burn(uint256 amount) public override whenNotPaused {
        super.burn(amount);
    }

    /**
     * @notice Burn nUSD tokens from account (requires allowance)
     * @param account Account to burn from
     * @param amount Amount to burn
     */
    function burnFrom(address account, uint256 amount) public override whenNotPaused {
        super.burnFrom(account, amount);
    }

    /**
     * @notice Pause all transfers
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause transfers
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Hook to check pause state before transfers
     * OZ v5 uses _update instead of _beforeTokenTransfer
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
