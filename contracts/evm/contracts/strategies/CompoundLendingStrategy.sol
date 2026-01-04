// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title CompoundLendingStrategy
 * @notice Supplies USDC to Compound v3 (Comet) for yield generation
 * @dev Implements IStrategy interface for SafeYieldVault compatibility
 */
contract CompoundLendingStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    uint256 public constant MAX_UTILIZATION_RATE = 9000;  // 90% - Emergency exit threshold
    uint256 public constant ALERT_UTILIZATION_RATE = 8000; // 80% - Alert threshold
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant SECONDS_PER_YEAR = 31536000;

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    IERC20 public immutable asset;          // USDC
    IComet public immutable comet;          // Compound v3 Comet
    address public vault;                    // SafeYieldVault address
    
    uint256 public totalDeposited;
    uint256 public lastHarvestTime;
    bool public emergencyMode;

    // ============================================================================
    // EVENTS
    // ============================================================================
    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event Harvested(uint256 yield);
    event EmergencyExitTriggered(uint256 withdrawn, uint256 utilization);
    event UtilizationAlert(uint256 utilization);
    event VaultUpdated(address oldVault, address newVault);

    // ============================================================================
    // ERRORS
    // ============================================================================
    error OnlyVault();
    error UtilizationTooHigh(uint256 current, uint256 maximum);
    error EmergencyModeActive();
    error InsufficientBalance(uint256 requested, uint256 available);

    // ============================================================================
    // MODIFIERS
    // ============================================================================
    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    modifier notEmergency() {
        if (emergencyMode) revert EmergencyModeActive();
        _;
    }

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    constructor(
        address _asset,
        address _comet,
        address _vault
    ) Ownable(msg.sender) {
        asset = IERC20(_asset);
        comet = IComet(_comet);
        vault = _vault;
        
        // Approve Comet to spend USDC
        asset.safeApprove(_comet, type(uint256).max);
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    /**
     * @notice Deposit USDC into Compound v3
     * @param amount Amount of USDC to deposit
     * @return Amount deposited
     */
    function deposit(uint256 amount) external onlyVault notEmergency nonReentrant returns (uint256) {
        // Check utilization before deposit
        uint256 utilization = _getPoolUtilization();
        if (utilization >= ALERT_UTILIZATION_RATE) {
            emit UtilizationAlert(utilization);
        }
        if (utilization >= MAX_UTILIZATION_RATE) {
            revert UtilizationTooHigh(utilization, MAX_UTILIZATION_RATE);
        }

        // Transfer USDC from vault
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // Supply to Compound
        comet.supply(address(asset), amount);
        totalDeposited += amount;

        emit Deposited(amount);
        return amount;
    }

    /**
     * @notice Withdraw USDC from Compound v3
     * @param amount Amount of USDC to withdraw
     * @return withdrawn Actual amount withdrawn
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 available = totalDeposits();
        if (amount > available) {
            revert InsufficientBalance(amount, available);
        }

        // Withdraw from Compound
        comet.withdraw(address(asset), amount);
        
        // Transfer to vault
        asset.safeTransfer(vault, amount);
        
        // Update tracking
        if (amount >= totalDeposited) {
            totalDeposited = 0;
        } else {
            totalDeposited -= amount;
        }

        emit Withdrawn(amount);
        return amount;
    }

    /**
     * @notice Harvest yield and send to vault
     * @return yield Amount of yield harvested
     */
    function harvest() external onlyVault nonReentrant returns (uint256 yield) {
        uint256 currentBalance = comet.balanceOf(address(this));
        
        // Yield is difference between current balance and deposited principal
        if (currentBalance > totalDeposited) {
            yield = currentBalance - totalDeposited;
            
            // Withdraw yield from Compound
            comet.withdraw(address(asset), yield);
            
            // Transfer to vault
            asset.safeTransfer(vault, yield);
            
            lastHarvestTime = block.timestamp;
            emit Harvested(yield);
        }
        
        return yield;
    }

    /**
     * @notice Emergency exit - withdraw all funds
     * @return withdrawn Total amount withdrawn
     */
    function emergencyExit() external onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 utilization = _getPoolUtilization();
        uint256 balance = comet.balanceOf(address(this));
        
        if (balance == 0) return 0;

        // Withdraw all from Compound
        comet.withdraw(address(asset), balance);
        
        // Transfer to vault
        withdrawn = asset.balanceOf(address(this));
        asset.safeTransfer(vault, withdrawn);
        
        totalDeposited = 0;
        emergencyMode = true;

        emit EmergencyExitTriggered(withdrawn, utilization);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get total deposits including accrued yield
     * @return Total value in USDC terms
     */
    function totalDeposits() public view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    /**
     * @notice Get pool utilization rate
     * @return Utilization in basis points (0-10000)
     */
    function utilizationRate() external view returns (uint256) {
        return _getPoolUtilization();
    }

    /**
     * @notice Get current supply APY from Compound
     * @return APY in basis points
     */
    function currentAPY() external view returns (uint256) {
        uint256 supplyRate = comet.getSupplyRate(comet.getUtilization());
        // supplyRate is per second, convert to annual basis points
        return (supplyRate * SECONDS_PER_YEAR * BASIS_POINTS) / 1e18;
    }

    /**
     * @notice Get pending yield (not yet harvested)
     */
    function pendingYield() external view returns (uint256) {
        uint256 currentBalance = comet.balanceOf(address(this));
        if (currentBalance > totalDeposited) {
            return currentBalance - totalDeposited;
        }
        return 0;
    }

    /**
     * @notice Check if utilization is at alert level
     */
    function isUtilizationAlert() external view returns (bool) {
        return _getPoolUtilization() >= ALERT_UTILIZATION_RATE;
    }

    /**
     * @notice Check if utilization is at emergency level
     */
    function isUtilizationEmergency() external view returns (bool) {
        return _getPoolUtilization() >= MAX_UTILIZATION_RATE;
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _getPoolUtilization() internal view returns (uint256) {
        uint256 utilization = comet.getUtilization();
        // Comet returns utilization as a mantissa (1e18 = 100%)
        return (utilization * BASIS_POINTS) / 1e18;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /**
     * @notice Update vault address
     */
    function setVault(address _vault) external onlyOwner {
        emit VaultUpdated(vault, _vault);
        vault = _vault;
    }

    /**
     * @notice Reset emergency mode
     */
    function resetEmergencyMode() external onlyOwner {
        emergencyMode = false;
    }

    /**
     * @notice Rescue stuck tokens (not USDC)
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(asset), "Cannot rescue strategy tokens");
        IERC20(token).safeTransfer(owner(), amount);
    }
}

// ============================================================================
// COMPOUND V3 INTERFACES
// ============================================================================

interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint64);
    function getUtilization() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function totalBorrow() external view returns (uint256);
}
