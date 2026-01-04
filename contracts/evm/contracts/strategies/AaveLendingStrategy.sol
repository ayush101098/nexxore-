// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AaveLendingStrategy
 * @notice Supplies USDC to Aave v3 pool for yield generation
 * @dev Implements IStrategy interface for SafeYieldVault compatibility
 */
contract AaveLendingStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    uint256 public constant MAX_UTILIZATION_RATE = 9000;  // 90% - Emergency exit threshold
    uint256 public constant ALERT_UTILIZATION_RATE = 8000; // 80% - Alert threshold
    uint256 public constant BASIS_POINTS = 10000;

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    IERC20 public immutable asset;          // USDC
    IERC20 public immutable aToken;         // aUSDC
    IPool public immutable aavePool;        // Aave v3 Pool
    address public vault;                    // SafeYieldVault address
    
    uint256 public totalDeposited;
    uint256 public lastHarvestTime;
    bool public emergencyMode;

    // ============================================================================
    // EVENTS
    // ============================================================================
    event Deposited(uint256 amount, uint256 aTokenReceived);
    event Withdrawn(uint256 amount, uint256 aTokenBurned);
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
        address _aToken,
        address _aavePool,
        address _vault
    ) Ownable(msg.sender) {
        asset = IERC20(_asset);
        aToken = IERC20(_aToken);
        aavePool = IPool(_aavePool);
        vault = _vault;
        
        // Approve Aave pool to spend USDC
        asset.safeApprove(_aavePool, type(uint256).max);
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    /**
     * @notice Deposit USDC into Aave v3 pool
     * @param amount Amount of USDC to deposit
     * @return aTokenAmount Amount of aTokens received
     */
    function deposit(uint256 amount) external onlyVault notEmergency nonReentrant returns (uint256 aTokenAmount) {
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

        // Get aToken balance before
        uint256 aTokenBefore = aToken.balanceOf(address(this));

        // Supply to Aave
        aavePool.supply(address(asset), amount, address(this), 0);

        // Calculate aTokens received
        aTokenAmount = aToken.balanceOf(address(this)) - aTokenBefore;
        totalDeposited += amount;

        emit Deposited(amount, aTokenAmount);
    }

    /**
     * @notice Withdraw USDC from Aave v3 pool
     * @param amount Amount of USDC to withdraw
     * @return withdrawn Actual amount withdrawn
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 available = totalDeposits();
        if (amount > available) {
            revert InsufficientBalance(amount, available);
        }

        // Withdraw from Aave
        withdrawn = aavePool.withdraw(address(asset), amount, vault);
        
        // Update tracking (handle any rounding)
        if (withdrawn >= totalDeposited) {
            totalDeposited = 0;
        } else {
            totalDeposited -= withdrawn;
        }

        emit Withdrawn(withdrawn, amount);
    }

    /**
     * @notice Harvest yield and send to vault
     * @return yield Amount of yield harvested
     */
    function harvest() external onlyVault nonReentrant returns (uint256 yield) {
        uint256 currentBalance = aToken.balanceOf(address(this));
        
        // Yield is difference between aToken balance and deposited principal
        if (currentBalance > totalDeposited) {
            yield = currentBalance - totalDeposited;
            
            // Withdraw yield from Aave
            uint256 withdrawn = aavePool.withdraw(address(asset), yield, vault);
            
            lastHarvestTime = block.timestamp;
            emit Harvested(withdrawn);
            
            return withdrawn;
        }
        
        return 0;
    }

    /**
     * @notice Emergency exit - withdraw all funds when utilization exceeds 90%
     * @return withdrawn Total amount withdrawn
     */
    function emergencyExit() external onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 utilization = _getPoolUtilization();
        
        // Can be called when utilization is high or by vault in emergency
        uint256 aTokenBalance = aToken.balanceOf(address(this));
        if (aTokenBalance == 0) return 0;

        // Withdraw all from Aave
        withdrawn = aavePool.withdraw(address(asset), type(uint256).max, vault);
        
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
        return aToken.balanceOf(address(this));
    }

    /**
     * @notice Get pool utilization rate
     * @return Utilization in basis points (0-10000)
     */
    function utilizationRate() external view returns (uint256) {
        return _getPoolUtilization();
    }

    /**
     * @notice Get current APY from Aave
     * @return APY in basis points
     */
    function currentAPY() external view returns (uint256) {
        DataTypes.ReserveData memory reserveData = aavePool.getReserveData(address(asset));
        // liquidityRate is in RAY (1e27), convert to basis points
        return reserveData.currentLiquidityRate / 1e23;
    }

    /**
     * @notice Get pending yield (not yet harvested)
     */
    function pendingYield() external view returns (uint256) {
        uint256 currentBalance = aToken.balanceOf(address(this));
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
        DataTypes.ReserveData memory reserveData = aavePool.getReserveData(address(asset));
        
        // Get total supply and total borrows
        uint256 totalSupply = IERC20(reserveData.aTokenAddress).totalSupply();
        uint256 totalBorrows = IERC20(reserveData.variableDebtTokenAddress).totalSupply() +
                              IERC20(reserveData.stableDebtTokenAddress).totalSupply();
        
        if (totalSupply == 0) return 0;
        
        return (totalBorrows * BASIS_POINTS) / totalSupply;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /**
     * @notice Update vault address
     * @dev Only callable by owner (governance)
     */
    function setVault(address _vault) external onlyOwner {
        emit VaultUpdated(vault, _vault);
        vault = _vault;
    }

    /**
     * @notice Reset emergency mode
     * @dev Only callable by owner after situation is resolved
     */
    function resetEmergencyMode() external onlyOwner {
        emergencyMode = false;
    }

    /**
     * @notice Rescue stuck tokens (not USDC or aUSDC)
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(asset) && token != address(aToken), "Cannot rescue strategy tokens");
        IERC20(token).safeTransfer(owner(), amount);
    }
}

// ============================================================================
// AAVE V3 INTERFACES
// ============================================================================

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory);
}

library DataTypes {
    struct ReserveData {
        //stores the reserve configuration
        uint256 configuration;
        //the liquidity index. Expressed in ray
        uint128 liquidityIndex;
        //the current supply rate. Expressed in ray
        uint128 currentLiquidityRate;
        //variable borrow index. Expressed in ray
        uint128 variableBorrowIndex;
        //the current variable borrow rate. Expressed in ray
        uint128 currentVariableBorrowRate;
        //the current stable borrow rate. Expressed in ray
        uint128 currentStableBorrowRate;
        //timestamp of last update
        uint40 lastUpdateTimestamp;
        //the id of the reserve
        uint16 id;
        //aToken address
        address aTokenAddress;
        //stableDebtToken address
        address stableDebtTokenAddress;
        //variableDebtToken address
        address variableDebtTokenAddress;
        //address of the interest rate strategy
        address interestRateStrategyAddress;
        //the current treasury balance, scaled
        uint128 accruedToTreasury;
        //the outstanding unbacked aTokens minted through the bridging feature
        uint128 unbacked;
        //the outstanding debt borrowed against this asset in isolation mode
        uint128 isolationModeTotalDebt;
    }
}
