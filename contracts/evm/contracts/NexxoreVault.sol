// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NexxoreVault
 * @notice Simple deposit vault for ERC20 tokens and ETH
 * @dev Users deposit tokens, vault stores them safely
 */
contract NexxoreVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============
    
    mapping(address => mapping(address => uint256)) public userDeposits; // user => token => amount
    mapping(address => uint256) public totalDeposits; // token => total amount

    // ============ Events ============

    event TokenDeposit(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );
    
    event ETHDeposit(
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    // ============ Errors ============

    error ZeroAmount();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        // No initialization needed
    }

    // ============ Deposit Functions ============

    /**
     * @notice Deposit ERC20 tokens (USDT, USDC, etc.)
     * @param token The ERC20 token address
     * @param amount Amount to deposit
     */
    function depositToken(address token, uint256 amount) 
        external 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();

        // Transfer tokens from user to vault
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update balances
        userDeposits[msg.sender][token] += amount;
        totalDeposits[token] += amount;

        emit TokenDeposit(msg.sender, token, amount, block.timestamp);
    }

    /**
     * @notice Deposit ETH
     */
    function depositETH() 
        external 
        payable 
        nonReentrant 
    {
        if (msg.value == 0) revert ZeroAmount();

        // Update balances (use address(0) for ETH)
        userDeposits[msg.sender][address(0)] += msg.value;
        totalDeposits[address(0)] += msg.value;

        emit ETHDeposit(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Fallback to receive ETH
     */
    receive() external payable {
        if (msg.value > 0) {
            userDeposits[msg.sender][address(0)] += msg.value;
            totalDeposits[address(0)] += msg.value;
            emit ETHDeposit(msg.sender, msg.value, block.timestamp);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get user's token balance
     * @param user User address
     * @param token Token address (use address(0) for ETH)
     */
    function getUserBalance(address user, address token) 
        external 
        view 
        returns (uint256) 
    {
        return userDeposits[user][token];
    }

    /**
     * @notice Get total deposits for a token
     * @param token Token address (use address(0) for ETH)
     */
    function getTotalDeposits(address token) 
        external 
        view 
        returns (uint256) 
    {
        return totalDeposits[token];
    }

    /**
     * @notice Get vault's token balance
     * @param token Token address
     */
    function getVaultBalance(address token) 
        external 
        view 
        returns (uint256) 
    {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }
}
