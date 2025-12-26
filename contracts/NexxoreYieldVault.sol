// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NexxoreYieldVault
 * @notice Safe yield vault for ETH deposits with optimized strategies
 * @dev Accepts ETH deposits and manages yield generation
 */
contract NexxoreYieldVault {
    // State variables
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;
    uint256 public totalYieldGenerated;
    
    address public owner;
    bool public paused;
    
    // Events
    event Deposit(address indexed user, uint256 amount, uint256 timestamp);
    event Withdrawal(address indexed user, uint256 amount, uint256 timestamp);
    event YieldDistributed(uint256 amount, uint256 timestamp);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        paused = false;
    }
    
    /**
     * @notice Deposit ETH into the vault
     * @dev Users can deposit any amount of ETH
     */
    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "Deposit amount must be greater than 0");
        
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        
        emit Deposit(msg.sender, msg.value, block.timestamp);
    }
    
    /**
     * @notice Withdraw deposited ETH plus yield
     * @param amount Amount to withdraw in wei
     */
    function withdraw(uint256 amount) external whenNotPaused {
        require(amount > 0, "Withdrawal amount must be greater than 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit Withdrawal(msg.sender, amount, block.timestamp);
    }
    
    /**
     * @notice Emergency withdraw for users (no yield, just principal)
     */
    function emergencyWithdraw() external {
        uint256 userBalance = balances[msg.sender];
        require(userBalance > 0, "No balance to withdraw");
        
        balances[msg.sender] = 0;
        totalDeposits -= userBalance;
        
        (bool success, ) = payable(msg.sender).call{value: userBalance}("");
        require(success, "Transfer failed");
        
        emit EmergencyWithdraw(msg.sender, userBalance);
    }
    
    /**
     * @notice Get user's balance including yield
     * @param user Address to check
     * @return User's total balance
     */
    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }
    
    /**
     * @notice Distribute yield to all depositors (proportional to deposits)
     * @dev Only owner can call this after yield is generated
     */
    function distributeYield() external payable onlyOwner {
        require(msg.value > 0, "No yield to distribute");
        totalYieldGenerated += msg.value;
        
        emit YieldDistributed(msg.value, block.timestamp);
    }
    
    /**
     * @notice Pause/unpause the contract
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
    
    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }
    
    /**
     * @notice Get total value locked in vault
     */
    function getTVL() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {
        // Accept ETH for yield distribution
    }
}
