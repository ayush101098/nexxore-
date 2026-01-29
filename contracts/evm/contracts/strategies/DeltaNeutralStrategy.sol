// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DeltaNeutralStrategy
 * @notice Implements delta-neutral yield by holding spot + shorting perps
 * @dev Captures funding rate yield while being market neutral
 * 
 * Strategy:
 * 1. Hold ETH spot
 * 2. Open short perp position on Hyperliquid (via off-chain)
 * 3. Collect positive funding when longs pay shorts
 * 4. Maintain 1:1 hedge ratio
 */
contract DeltaNeutralStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // State
    address public vault;
    address public keeper;  // Off-chain bot that manages perp position
    
    uint256 public spotBalance;      // ETH held in this contract
    uint256 public hedgeSize;        // Size of short perp position (tracked off-chain)
    int256 public unrealizedPnL;     // PnL from perp position
    uint256 public accumulatedYield; // Funding payments received
    
    // Parameters
    uint256 public maxHedgeRatio = 10500;  // 105% max hedge (basis points)
    uint256 public minHedgeRatio = 9500;   // 95% min hedge (basis points)
    uint256 public constant BPS = 10000;
    
    // Events
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event HedgeUpdated(uint256 newHedgeSize, int256 pnl);
    event FundingReceived(uint256 amount);
    event YieldHarvested(uint256 amount);
    
    // Errors
    error OnlyVault();
    error OnlyKeeper();
    error HedgeImbalanced();
    
    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }
    
    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        _;
    }
    
    constructor(address _vault, address _keeper) Ownable(msg.sender) {
        vault = _vault;
        keeper = _keeper;
    }
    
    /**
     * @notice Deposit ETH into strategy
     * @dev Keeper should open matching short after deposit
     */
    function deposit() external payable onlyVault nonReentrant returns (uint256) {
        require(msg.value > 0, "Zero deposit");
        
        spotBalance += msg.value;
        
        emit Deposited(msg.value);
        
        return msg.value;
    }
    
    /**
     * @notice Withdraw ETH from strategy
     * @dev Keeper should close matching short before/after withdrawal
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256) {
        require(amount <= spotBalance, "Insufficient balance");
        
        spotBalance -= amount;
        
        // Transfer ETH to vault
        (bool success, ) = vault.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit Withdrawn(amount);
        
        return amount;
    }
    
    /**
     * @notice Update hedge position (called by keeper)
     * @param newHedgeSize New size of short position
     * @param pnl Realized PnL from position adjustment
     */
    function updateHedge(uint256 newHedgeSize, int256 pnl) external onlyKeeper {
        hedgeSize = newHedgeSize;
        unrealizedPnL = pnl;
        
        emit HedgeUpdated(newHedgeSize, pnl);
    }
    
    /**
     * @notice Record funding payment received (called by keeper)
     * @param amount Funding payment amount in ETH
     */
    function recordFunding(uint256 amount) external payable onlyKeeper {
        // Keeper sends funding profits to this contract
        accumulatedYield += amount;
        
        emit FundingReceived(amount);
    }
    
    /**
     * @notice Harvest accumulated yield to vault
     */
    function harvestYield() external onlyVault returns (uint256) {
        uint256 yield = accumulatedYield;
        accumulatedYield = 0;
        
        if (yield > 0) {
            (bool success, ) = vault.call{value: yield}("");
            require(success, "Transfer failed");
        }
        
        emit YieldHarvested(yield);
        
        return yield;
    }
    
    /**
     * @notice Get total value of strategy (spot + perp PnL)
     */
    function totalValue() external view returns (uint256) {
        if (unrealizedPnL >= 0) {
            return spotBalance + uint256(unrealizedPnL) + accumulatedYield;
        } else {
            uint256 loss = uint256(-unrealizedPnL);
            return spotBalance > loss ? spotBalance - loss + accumulatedYield : accumulatedYield;
        }
    }
    
    /**
     * @notice Check if hedge is within acceptable range
     */
    function isHedgeBalanced() external view returns (bool) {
        if (spotBalance == 0) return hedgeSize == 0;
        
        uint256 hedgeRatio = (hedgeSize * BPS) / spotBalance;
        return hedgeRatio >= minHedgeRatio && hedgeRatio <= maxHedgeRatio;
    }
    
    /**
     * @notice Get current hedge ratio
     */
    function getHedgeRatio() external view returns (uint256) {
        if (spotBalance == 0) return 0;
        return (hedgeSize * BPS) / spotBalance;
    }
    
    /**
     * @notice Emergency withdraw all (guardian only)
     */
    function emergencyWithdraw() external onlyVault {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = vault.call{value: balance}("");
            require(success, "Transfer failed");
        }
        spotBalance = 0;
        hedgeSize = 0;
        accumulatedYield = 0;
    }
    
    /**
     * @notice Update keeper address
     */
    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }
    
    /**
     * @notice Update hedge ratio bounds
     */
    function setHedgeRatioBounds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max && _max <= 12000, "Invalid bounds");
        minHedgeRatio = _min;
        maxHedgeRatio = _max;
    }
    
    // Receive ETH (for funding payments)
    receive() external payable {}
}
