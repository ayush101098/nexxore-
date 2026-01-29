// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LidoStakingStrategy
 * @notice Stakes ETH in Lido for stETH yield
 * @dev Used by StrategyRouter to earn yield on ETH collateral
 */
contract LidoStakingStrategy is Ownable, ReentrancyGuard {
    
    // Lido stETH interface
    ILido public immutable lido;
    
    // Authorized vault/router
    address public vault;
    
    // Tracking
    uint256 public totalDeposited;
    uint256 public totalStETH;
    
    // Events
    event Deposited(uint256 ethAmount, uint256 stETHReceived);
    event Withdrawn(uint256 stETHAmount, uint256 ethReceived);
    event YieldHarvested(uint256 amount);
    
    // Errors
    error OnlyVault();
    error InsufficientBalance();
    
    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }
    
    constructor(address _lido, address _vault) Ownable(msg.sender) {
        lido = ILido(_lido);
        vault = _vault;
    }
    
    /**
     * @notice Deposit ETH to Lido
     */
    function deposit() external payable onlyVault nonReentrant returns (uint256 stETHReceived) {
        require(msg.value > 0, "Zero deposit");
        
        uint256 balanceBefore = lido.balanceOf(address(this));
        
        // Submit ETH to Lido
        lido.submit{value: msg.value}(address(0));
        
        stETHReceived = lido.balanceOf(address(this)) - balanceBefore;
        
        totalDeposited += msg.value;
        totalStETH += stETHReceived;
        
        emit Deposited(msg.value, stETHReceived);
    }
    
    /**
     * @notice Withdraw stETH back to vault
     * @dev Note: Lido doesn't have instant unstake, this returns stETH
     *      In production, use Lido withdrawal queue or swap on DEX
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256) {
        if (amount > totalStETH) revert InsufficientBalance();
        
        // Transfer stETH to vault
        // Vault can then swap on Curve/Uniswap or wait for Lido withdrawal
        lido.transfer(vault, amount);
        
        totalStETH -= amount;
        
        emit Withdrawn(amount, amount); // 1:1 for stETH
        
        return amount;
    }
    
    /**
     * @notice Get current balance including yield
     */
    function balanceOf() external view returns (uint256) {
        return lido.balanceOf(address(this));
    }
    
    /**
     * @notice Get current yield earned
     */
    function pendingYield() external view returns (uint256) {
        uint256 currentBalance = lido.balanceOf(address(this));
        return currentBalance > totalDeposited ? currentBalance - totalDeposited : 0;
    }
    
    /**
     * @notice Emergency withdraw all stETH
     */
    function emergencyWithdraw() external onlyVault {
        uint256 balance = lido.balanceOf(address(this));
        if (balance > 0) {
            lido.transfer(vault, balance);
        }
        totalStETH = 0;
    }
    
    /**
     * @notice Update vault address
     */
    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }
    
    // Receive ETH
    receive() external payable {}
}

/**
 * @title ILido
 * @notice Minimal Lido stETH interface
 */
interface ILido {
    function submit(address referral) external payable returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
