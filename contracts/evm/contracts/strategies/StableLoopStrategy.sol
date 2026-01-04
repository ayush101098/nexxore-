// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StableLoopStrategy
 * @notice Conservative leveraged lending strategy on Aave
 * @dev Recursively supplies and borrows USDC with strict LTV limits
 */
contract StableLoopStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    uint256 public constant MAX_LTV = 4000;              // 40% maximum LTV
    uint256 public constant HARD_STOP_LTV = 4500;        // 45% hard stop
    uint256 public constant SAFETY_BUFFER = 500;         // 5% safety buffer
    uint256 public constant MAX_STABLECOIN_DEVIATION = 50; // 0.5% max deviation
    uint256 public constant UNPROFITABLE_DURATION = 24 hours;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_LOOPS = 4;               // Maximum recursion depth

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    IERC20 public immutable usdc;
    IERC20 public immutable aUsdc;                       // Aave aToken
    IERC20 public immutable debtUsdc;                    // Aave debt token
    IPool public immutable aavePool;
    AggregatorV3Interface public immutable usdcPriceFeed;
    
    address public vault;
    
    // Position tracking
    uint256 public totalSupplied;
    uint256 public totalBorrowed;
    uint256 public initialDeposit;                       // Original deposit from vault
    
    // APY tracking for auto-unwind
    uint256 public lastProfitableTime;
    int256 public lastNetAPY;
    
    bool public emergencyMode;

    // ============================================================================
    // EVENTS
    // ============================================================================
    event LoopExecuted(uint256 loops, uint256 totalSupplied, uint256 totalBorrowed, uint256 leverage);
    event UnwindExecuted(uint256 repaid, uint256 withdrawn);
    event Deposited(uint256 amount, uint256 loops);
    event Withdrawn(uint256 amount);
    event Harvested(uint256 yield);
    event EmergencyExitTriggered(uint256 withdrawn, string reason);
    event UnprofitableAlert(int256 netAPY);
    event StablecoinDeviationAlert(uint256 price);

    // ============================================================================
    // ERRORS
    // ============================================================================
    error OnlyVault();
    error LTVTooHigh(uint256 current, uint256 maximum);
    error StablecoinDepegged(uint256 price);
    error EmergencyModeActive();
    error UnprofitablePosition(int256 netAPY);
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

    modifier checkStablecoinPeg() {
        uint256 price = getUSDCPrice();
        if (price < (BASIS_POINTS - MAX_STABLECOIN_DEVIATION) || 
            price > (BASIS_POINTS + MAX_STABLECOIN_DEVIATION)) {
            revert StablecoinDepegged(price);
        }
        _;
    }

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    constructor(
        address _usdc,
        address _aUsdc,
        address _debtUsdc,
        address _aavePool,
        address _usdcPriceFeed,
        address _vault
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        aUsdc = IERC20(_aUsdc);
        debtUsdc = IERC20(_debtUsdc);
        aavePool = IPool(_aavePool);
        usdcPriceFeed = AggregatorV3Interface(_usdcPriceFeed);
        vault = _vault;
        
        lastProfitableTime = block.timestamp;

        // Approvals
        usdc.forceApprove(_aavePool, type(uint256).max);
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    /**
     * @notice Deposit and create leveraged position
     * @param amount Amount of USDC to deposit
     */
    function deposit(uint256 amount) external onlyVault notEmergency checkStablecoinPeg nonReentrant returns (uint256) {
        // Check profitability
        int256 netAPY = calculateNetAPY();
        if (netAPY < 0 && block.timestamp > lastProfitableTime + UNPROFITABLE_DURATION) {
            revert UnprofitablePosition(netAPY);
        }

        // Transfer USDC from vault
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        initialDeposit += amount;

        // Execute looping strategy
        uint256 loops = _executeLoop(amount);

        emit Deposited(amount, loops);
        return amount;
    }

    /**
     * @notice Withdraw by unwinding leverage
     * @param amount Amount in initial deposit terms
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256) {
        if (amount > initialDeposit) {
            revert InsufficientBalance(amount, initialDeposit);
        }

        // Calculate proportion to unwind
        uint256 proportion = (amount * BASIS_POINTS) / initialDeposit;
        
        // Unwind position proportionally
        uint256 withdrawn = _unwindPosition(proportion);
        
        // Transfer to vault
        usdc.safeTransfer(vault, withdrawn);
        
        initialDeposit -= amount;

        emit Withdrawn(withdrawn);
        return withdrawn;
    }

    /**
     * @notice Harvest yield (supply APY - borrow APY on borrowed amount)
     */
    function harvest() external onlyVault nonReentrant returns (uint256) {
        // Net position value
        uint256 supplied = aUsdc.balanceOf(address(this));
        uint256 borrowed = debtUsdc.balanceOf(address(this));
        uint256 netValue = supplied > borrowed ? supplied - borrowed : 0;
        
        // Yield is net value minus initial deposit
        if (netValue <= initialDeposit) return 0;
        
        uint256 yield = netValue - initialDeposit;
        
        // To harvest, we need to reduce supply slightly
        if (yield > 0 && borrowed > 0) {
            // Repay some debt
            uint256 toRepay = yield > borrowed ? borrowed : yield;
            aavePool.repay(address(usdc), toRepay, 2, address(this));
            totalBorrowed -= toRepay;
            
            // Withdraw the yield
            aavePool.withdraw(address(usdc), yield, vault);
            totalSupplied -= yield;
        }

        emit Harvested(yield);
        return yield;
    }

    /**
     * @notice Emergency exit - fully unwind position
     */
    function emergencyExit() external onlyVault nonReentrant returns (uint256) {
        uint256 withdrawn = _fullUnwind();
        
        usdc.safeTransfer(vault, withdrawn);
        
        initialDeposit = 0;
        emergencyMode = true;

        emit EmergencyExitTriggered(withdrawn, "Emergency exit triggered");
        return withdrawn;
    }

    /**
     * @notice Auto-check and unwind if unprofitable for 24h
     */
    function checkAndUnwindIfUnprofitable() external returns (bool unwound) {
        int256 netAPY = calculateNetAPY();
        
        if (netAPY >= 0) {
            lastProfitableTime = block.timestamp;
            lastNetAPY = netAPY;
            return false;
        }

        emit UnprofitableAlert(netAPY);

        // Check if unprofitable for too long
        if (block.timestamp > lastProfitableTime + UNPROFITABLE_DURATION) {
            uint256 withdrawn = _fullUnwind();
            usdc.safeTransfer(vault, withdrawn);
            
            initialDeposit = 0;
            emergencyMode = true;

            emit EmergencyExitTriggered(withdrawn, "Unprofitable for 24h+");
            return true;
        }

        return false;
    }

    /**
     * @notice Check stablecoin peg and exit if needed
     */
    function checkAndExitOnDeviation() external returns (bool exited) {
        uint256 price = getUSDCPrice();
        
        if (price < (BASIS_POINTS - MAX_STABLECOIN_DEVIATION) || 
            price > (BASIS_POINTS + MAX_STABLECOIN_DEVIATION)) {
            
            emit StablecoinDeviationAlert(price);
            
            uint256 withdrawn = _fullUnwind();
            usdc.safeTransfer(vault, withdrawn);
            
            initialDeposit = 0;
            emergencyMode = true;

            emit EmergencyExitTriggered(withdrawn, "USDC deviation detected");
            return true;
        }
        return false;
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Total deposits (net position value)
     */
    function totalDeposits() public view returns (uint256) {
        uint256 supplied = aUsdc.balanceOf(address(this));
        uint256 borrowed = debtUsdc.balanceOf(address(this));
        return supplied > borrowed ? supplied - borrowed : 0;
    }

    /**
     * @notice Current LTV ratio
     */
    function currentLTV() public view returns (uint256) {
        uint256 supplied = aUsdc.balanceOf(address(this));
        if (supplied == 0) return 0;
        
        uint256 borrowed = debtUsdc.balanceOf(address(this));
        return (borrowed * BASIS_POINTS) / supplied;
    }

    /**
     * @notice Calculate net APY (supply - borrow on borrowed amount)
     */
    function calculateNetAPY() public view returns (int256) {
        DataTypes.ReserveData memory data = aavePool.getReserveData(address(usdc));
        
        // Convert from RAY (1e27) to basis points
        uint256 supplyAPY = data.currentLiquidityRate / 1e23;
        uint256 borrowAPY = data.currentVariableBorrowRate / 1e23;
        
        uint256 supplied = aUsdc.balanceOf(address(this));
        uint256 borrowed = debtUsdc.balanceOf(address(this));
        
        if (supplied == 0) return 0;
        
        // Net APY = (supply APY * supplied - borrow APY * borrowed) / supplied
        int256 supplyIncome = int256(supplyAPY * supplied);
        int256 borrowCost = int256(borrowAPY * borrowed);
        
        return (supplyIncome - borrowCost) / int256(supplied);
    }

    /**
     * @notice Current leverage ratio
     */
    function leverageRatio() external view returns (uint256) {
        if (initialDeposit == 0) return BASIS_POINTS;
        
        uint256 supplied = aUsdc.balanceOf(address(this));
        return (supplied * BASIS_POINTS) / initialDeposit;
    }

    /**
     * @notice Get USDC price from Chainlink
     */
    function getUSDCPrice() public view returns (uint256) {
        (, int256 price,,,) = usdcPriceFeed.latestRoundData();
        return (uint256(price) * BASIS_POINTS) / 1e8;
    }

    /**
     * @notice Utilization rate (always 0, position is isolated)
     */
    function utilizationRate() external pure returns (uint256) {
        return 0;
    }

    /**
     * @notice Current APY
     */
    function currentAPY() external view returns (uint256) {
        int256 netAPY = calculateNetAPY();
        return netAPY > 0 ? uint256(netAPY) : 0;
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    /**
     * @notice Execute the loop strategy
     */
    function _executeLoop(uint256 initialAmount) internal returns (uint256 loops) {
        uint256 currentAmount = initialAmount;
        
        for (uint256 i = 0; i < MAX_LOOPS; i++) {
            // Supply current amount
            aavePool.supply(address(usdc), currentAmount, address(this), 0);
            totalSupplied += currentAmount;
            
            // Calculate safe borrow amount (target 40% LTV)
            uint256 maxBorrow = (currentAmount * MAX_LTV) / BASIS_POINTS;
            
            // Apply safety buffer
            uint256 safeBorrow = (maxBorrow * (BASIS_POINTS - SAFETY_BUFFER)) / BASIS_POINTS;
            
            if (safeBorrow < 100e6) break; // Stop if borrow too small (100 USDC)
            
            // Borrow
            aavePool.borrow(address(usdc), safeBorrow, 2, 0, address(this));
            totalBorrowed += safeBorrow;
            
            currentAmount = safeBorrow;
            loops++;
            
            // Check we haven't exceeded hard stop
            if (currentLTV() >= HARD_STOP_LTV - SAFETY_BUFFER) break;
        }

        emit LoopExecuted(loops, totalSupplied, totalBorrowed, (totalSupplied * BASIS_POINTS) / initialDeposit);
    }

    /**
     * @notice Unwind a proportion of the position
     */
    function _unwindPosition(uint256 proportionBps) internal returns (uint256 withdrawn) {
        uint256 toRepay = (totalBorrowed * proportionBps) / BASIS_POINTS;
        uint256 toWithdraw = (totalSupplied * proportionBps) / BASIS_POINTS;
        
        // Iteratively unwind
        while (toRepay > 0) {
            // Withdraw to repay debt
            uint256 withdrawForRepay = toRepay > aUsdc.balanceOf(address(this)) - toWithdraw 
                ? aUsdc.balanceOf(address(this)) - toWithdraw 
                : toRepay;
            
            aavePool.withdraw(address(usdc), withdrawForRepay, address(this));
            totalSupplied -= withdrawForRepay;
            
            // Repay debt
            uint256 repayAmount = withdrawForRepay > debtUsdc.balanceOf(address(this)) 
                ? debtUsdc.balanceOf(address(this)) 
                : withdrawForRepay;
            
            if (repayAmount > 0) {
                aavePool.repay(address(usdc), repayAmount, 2, address(this));
                totalBorrowed -= repayAmount;
                toRepay -= repayAmount;
            } else {
                break;
            }
        }
        
        // Withdraw remaining
        if (toWithdraw > 0) {
            uint256 available = aUsdc.balanceOf(address(this));
            withdrawn = toWithdraw > available ? available : toWithdraw;
            aavePool.withdraw(address(usdc), withdrawn, address(this));
            totalSupplied -= withdrawn;
        }
        
        withdrawn = usdc.balanceOf(address(this));
        emit UnwindExecuted(toRepay, withdrawn);
    }

    /**
     * @notice Fully unwind the position
     */
    function _fullUnwind() internal returns (uint256 withdrawn) {
        // Repay all debt first
        while (debtUsdc.balanceOf(address(this)) > 0) {
            uint256 debt = debtUsdc.balanceOf(address(this));
            uint256 supply = aUsdc.balanceOf(address(this));
            
            // Withdraw enough to repay debt
            uint256 toWithdraw = debt > supply ? supply : debt;
            aavePool.withdraw(address(usdc), toWithdraw, address(this));
            totalSupplied -= toWithdraw;
            
            // Repay
            uint256 balance = usdc.balanceOf(address(this));
            uint256 toRepay = balance > debt ? debt : balance;
            aavePool.repay(address(usdc), toRepay, 2, address(this));
            totalBorrowed -= toRepay;
        }
        
        // Withdraw remaining supply
        uint256 remaining = aUsdc.balanceOf(address(this));
        if (remaining > 0) {
            aavePool.withdraw(address(usdc), remaining, address(this));
            totalSupplied = 0;
        }
        
        withdrawn = usdc.balanceOf(address(this));
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    function resetEmergencyMode() external onlyOwner {
        emergencyMode = false;
        lastProfitableTime = block.timestamp;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(usdc) && token != address(aUsdc), "Cannot rescue strategy tokens");
        IERC20(token).safeTransfer(owner(), amount);
    }
}

// ============================================================================
// INTERFACES
// ============================================================================

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256);
    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory);
}

library DataTypes {
    struct ReserveData {
        uint256 configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}
