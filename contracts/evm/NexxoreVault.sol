// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NexxoreVault
 * @notice Multi-asset ERC-4626-style vault for Nexxore protocol
 * @dev Simple, deterministic vault - no complex logic
 */
contract NexxoreVault is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    IERC20 public immutable asset;
    
    uint256 public totalAssets;
    uint256 public totalShares;
    
    mapping(address => uint256) public shares;

    // ============ Events ============

    event Deposit(
        address indexed user,
        uint256 assets,
        uint256 shares,
        uint256 timestamp
    );
    
    event Withdraw(
        address indexed user,
        uint256 assets,
        uint256 shares,
        uint256 timestamp
    );
    
    event EmergencyWithdraw(
        address indexed owner,
        uint256 amount,
        uint256 timestamp
    );

    // ============ Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientShares();
    error InsufficientAssets();

    // ============ Constructor ============

    constructor(address _asset) {
        if (_asset == address(0)) revert ZeroAddress();
        asset = IERC20(_asset);
    }

    // ============ Deposit Logic ============

    /**
     * @notice Deposit assets and receive shares
     * @param amount Amount of assets to deposit
     * @return sharesToMint Amount of shares minted
     */
    function deposit(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        returns (uint256 sharesToMint) 
    {
        if (amount == 0) revert ZeroAmount();

        // Calculate shares: first depositor gets 1:1, others get pro-rata
        sharesToMint = totalShares == 0
            ? amount
            : (amount * totalShares) / totalAssets;

        // Transfer assets from user
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // Update state
        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalAssets += amount;

        emit Deposit(msg.sender, amount, sharesToMint, block.timestamp);
    }

    /**
     * @notice Deposit on behalf of another address
     * @param amount Amount to deposit
     * @param receiver Address to receive shares
     */
    function depositFor(uint256 amount, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesToMint)
    {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        sharesToMint = totalShares == 0
            ? amount
            : (amount * totalShares) / totalAssets;

        asset.safeTransferFrom(msg.sender, address(this), amount);

        shares[receiver] += sharesToMint;
        totalShares += sharesToMint;
        totalAssets += amount;

        emit Deposit(receiver, amount, sharesToMint, block.timestamp);
    }

    // ============ Withdrawal Logic ============

    /**
     * @notice Burn shares and receive assets
     * @param shareAmount Amount of shares to burn
     * @return assetsToReturn Amount of assets returned
     */
    function withdraw(uint256 shareAmount) 
        external 
        nonReentrant 
        returns (uint256 assetsToReturn) 
    {
        if (shareAmount == 0) revert ZeroAmount();
        if (shares[msg.sender] < shareAmount) revert InsufficientShares();

        // Calculate assets to return
        assetsToReturn = (shareAmount * totalAssets) / totalShares;

        if (assetsToReturn > totalAssets) revert InsufficientAssets();

        // Update state
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetsToReturn;

        // Transfer assets to user
        asset.safeTransfer(msg.sender, assetsToReturn);

        emit Withdraw(msg.sender, assetsToReturn, shareAmount, block.timestamp);
    }

    /**
     * @notice Withdraw by specifying asset amount instead of shares
     * @param assetAmount Desired amount of assets
     */
    function withdrawAssets(uint256 assetAmount)
        external
        nonReentrant
        returns (uint256 sharesBurned)
    {
        if (assetAmount == 0) revert ZeroAmount();
        if (assetAmount > totalAssets) revert InsufficientAssets();

        // Calculate shares to burn
        sharesBurned = (assetAmount * totalShares) / totalAssets;
        
        if (shares[msg.sender] < sharesBurned) revert InsufficientShares();

        shares[msg.sender] -= sharesBurned;
        totalShares -= sharesBurned;
        totalAssets -= assetAmount;

        asset.safeTransfer(msg.sender, assetAmount);

        emit Withdraw(msg.sender, assetAmount, sharesBurned, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @notice Get share balance of user
     */
    function balanceOf(address user) external view returns (uint256) {
        return shares[user];
    }

    /**
     * @notice Convert shares to assets
     */
    function convertToAssets(uint256 shareAmount) 
        external 
        view 
        returns (uint256) 
    {
        if (totalShares == 0) return 0;
        return (shareAmount * totalAssets) / totalShares;
    }

    /**
     * @notice Convert assets to shares
     */
    function convertToShares(uint256 assetAmount) 
        external 
        view 
        returns (uint256) 
    {
        if (totalShares == 0) return assetAmount;
        return (assetAmount * totalShares) / totalAssets;
    }

    // ============ Admin Functions ============

    /**
     * @notice Pause deposits (emergency only)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause deposits
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdrawal (owner only, last resort)
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        asset.safeTransfer(owner(), amount);
        emit EmergencyWithdraw(owner(), amount, block.timestamp);
    }
}
