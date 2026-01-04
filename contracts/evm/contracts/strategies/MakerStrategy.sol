// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title MakerStrategy
 * @notice Converts USDC to DAI and stakes in Maker's DSR (sDAI)
 * @dev Monitors DAI price for depeg events and auto-exits
 */
contract MakerStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    uint256 public constant DEPEG_THRESHOLD = 200;     // 2% deviation triggers exit
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant DAI_DECIMALS = 18;
    uint256 public constant USDC_DECIMALS = 6;

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    IERC20 public immutable usdc;
    IERC20 public immutable dai;
    IERC4626 public immutable sDAI;                    // Maker's sDAI (DSR)
    ISwapRouter public immutable swapRouter;           // Uniswap V3 router
    AggregatorV3Interface public immutable daiPriceFeed; // Chainlink DAI/USD
    
    address public vault;
    uint256 public totalDeposited;                     // In USDC terms
    uint256 public sDAIBalance;
    uint256 public lastHarvestTime;
    bool public emergencyMode;

    // Swap settings
    uint24 public poolFee = 100;                       // 0.01% Uniswap fee tier
    uint256 public maxSlippage = 50;                   // 0.5% max slippage

    // ============================================================================
    // EVENTS
    // ============================================================================
    event Deposited(uint256 usdcAmount, uint256 daiAmount, uint256 sDAIAmount);
    event Withdrawn(uint256 sDAIAmount, uint256 daiAmount, uint256 usdcAmount);
    event Harvested(uint256 yield);
    event EmergencyExitTriggered(uint256 withdrawn, string reason);
    event DepegAlert(uint256 price, uint256 threshold);
    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    // ============================================================================
    // ERRORS
    // ============================================================================
    error OnlyVault();
    error DAIDepegged(uint256 price);
    error EmergencyModeActive();
    error InsufficientBalance(uint256 requested, uint256 available);
    error SlippageTooHigh(uint256 expected, uint256 received);

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

    modifier checkDepeg() {
        uint256 daiPrice = getDaiPrice();
        if (daiPrice < (BASIS_POINTS - DEPEG_THRESHOLD) || daiPrice > (BASIS_POINTS + DEPEG_THRESHOLD)) {
            revert DAIDepegged(daiPrice);
        }
        _;
    }

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    constructor(
        address _usdc,
        address _dai,
        address _sDAI,
        address _swapRouter,
        address _daiPriceFeed,
        address _vault
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        dai = IERC20(_dai);
        sDAI = IERC4626(_sDAI);
        swapRouter = ISwapRouter(_swapRouter);
        daiPriceFeed = AggregatorV3Interface(_daiPriceFeed);
        vault = _vault;

        // Approvals
        usdc.safeApprove(_swapRouter, type(uint256).max);
        dai.safeApprove(_swapRouter, type(uint256).max);
        dai.safeApprove(_sDAI, type(uint256).max);
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    /**
     * @notice Deposit USDC, convert to DAI, stake in sDAI
     * @param amount Amount of USDC to deposit
     */
    function deposit(uint256 amount) external onlyVault notEmergency checkDepeg nonReentrant returns (uint256) {
        // Transfer USDC from vault
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Swap USDC to DAI
        uint256 daiReceived = _swapUSDCtoDAI(amount);

        // Stake DAI in sDAI (DSR)
        uint256 sDAIReceived = sDAI.deposit(daiReceived, address(this));
        
        sDAIBalance += sDAIReceived;
        totalDeposited += amount;

        emit Deposited(amount, daiReceived, sDAIReceived);
        return amount;
    }

    /**
     * @notice Withdraw - unstake sDAI, convert DAI to USDC
     * @param amount Amount in USDC terms to withdraw
     */
    function withdraw(uint256 amount) external onlyVault nonReentrant returns (uint256) {
        // Calculate sDAI needed
        uint256 daiNeeded = _usdcToDai(amount);
        uint256 sDAINeeded = sDAI.convertToShares(daiNeeded);
        
        if (sDAINeeded > sDAIBalance) {
            revert InsufficientBalance(sDAINeeded, sDAIBalance);
        }

        // Redeem sDAI for DAI
        uint256 daiReceived = sDAI.redeem(sDAINeeded, address(this), address(this));
        sDAIBalance -= sDAINeeded;

        // Swap DAI to USDC
        uint256 usdcReceived = _swapDAItoUSDC(daiReceived);

        // Transfer to vault
        usdc.safeTransfer(vault, usdcReceived);
        
        // Update tracking
        if (usdcReceived >= totalDeposited) {
            totalDeposited = 0;
        } else {
            totalDeposited -= usdcReceived;
        }

        emit Withdrawn(sDAINeeded, daiReceived, usdcReceived);
        return usdcReceived;
    }

    /**
     * @notice Harvest yield from DSR
     */
    function harvest() external onlyVault nonReentrant returns (uint256) {
        uint256 currentValue = _getCurrentValueInUSDC();
        
        if (currentValue <= totalDeposited) return 0;
        
        uint256 yield = currentValue - totalDeposited;
        
        // Calculate sDAI to redeem for yield
        uint256 daiYield = _usdcToDai(yield);
        uint256 sDAIToRedeem = sDAI.convertToShares(daiYield);
        
        if (sDAIToRedeem > sDAIBalance) {
            sDAIToRedeem = sDAIBalance;
        }

        // Redeem yield portion
        uint256 daiReceived = sDAI.redeem(sDAIToRedeem, address(this), address(this));
        sDAIBalance -= sDAIToRedeem;

        // Swap to USDC
        uint256 usdcReceived = _swapDAItoUSDC(daiReceived);
        
        // Transfer to vault
        usdc.safeTransfer(vault, usdcReceived);

        lastHarvestTime = block.timestamp;
        emit Harvested(usdcReceived);
        
        return usdcReceived;
    }

    /**
     * @notice Emergency exit - triggered on depeg
     */
    function emergencyExit() external onlyVault nonReentrant returns (uint256) {
        if (sDAIBalance == 0) return 0;

        // Redeem all sDAI
        uint256 daiReceived = sDAI.redeem(sDAIBalance, address(this), address(this));
        sDAIBalance = 0;

        // Swap all DAI to USDC (accept higher slippage in emergency)
        uint256 usdcReceived = _swapDAItoUSDC(daiReceived);
        
        // Transfer to vault
        usdc.safeTransfer(vault, usdcReceived);
        
        totalDeposited = 0;
        emergencyMode = true;

        emit EmergencyExitTriggered(usdcReceived, "Manual trigger or depeg");
        return usdcReceived;
    }

    /**
     * @notice Check DAI price and exit if depegged
     */
    function checkAndExitOnDepeg() external returns (bool exited) {
        uint256 daiPrice = getDaiPrice();
        
        if (daiPrice < (BASIS_POINTS - DEPEG_THRESHOLD) || daiPrice > (BASIS_POINTS + DEPEG_THRESHOLD)) {
            emit DepegAlert(daiPrice, DEPEG_THRESHOLD);
            
            // Execute emergency exit
            if (sDAIBalance > 0) {
                uint256 daiReceived = sDAI.redeem(sDAIBalance, address(this), address(this));
                sDAIBalance = 0;

                uint256 usdcReceived = _swapDAItoUSDC(daiReceived);
                usdc.safeTransfer(vault, usdcReceived);
                
                totalDeposited = 0;
                emergencyMode = true;

                emit EmergencyExitTriggered(usdcReceived, "DAI depeg detected");
                return true;
            }
        }
        return false;
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get total deposits in USDC terms
     */
    function totalDeposits() public view returns (uint256) {
        return _getCurrentValueInUSDC();
    }

    /**
     * @notice Get current DAI price from Chainlink
     * @return Price in basis points (10000 = $1.00)
     */
    function getDaiPrice() public view returns (uint256) {
        (, int256 price,,,) = daiPriceFeed.latestRoundData();
        // Chainlink DAI/USD has 8 decimals
        return (uint256(price) * BASIS_POINTS) / 1e8;
    }

    /**
     * @notice Get current sDAI exchange rate
     */
    function getSDAIExchangeRate() external view returns (uint256) {
        return sDAI.convertToAssets(1e18);
    }

    /**
     * @notice Current DSR APY
     */
    function currentAPY() external view returns (uint256) {
        // sDAI exchange rate appreciation represents DSR yield
        // This is a simplified calculation
        uint256 rate = sDAI.convertToAssets(1e18);
        // rate > 1e18 means yield has accrued
        if (rate > 1e18) {
            return ((rate - 1e18) * BASIS_POINTS) / 1e18;
        }
        return 0;
    }

    /**
     * @notice Utilization rate (always 0 for DSR)
     */
    function utilizationRate() external pure returns (uint256) {
        return 0; // DSR has no utilization concept
    }

    /**
     * @notice Check if DAI is depegged
     */
    function isDepegged() external view returns (bool) {
        uint256 daiPrice = getDaiPrice();
        return daiPrice < (BASIS_POINTS - DEPEG_THRESHOLD) || daiPrice > (BASIS_POINTS + DEPEG_THRESHOLD);
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _getCurrentValueInUSDC() internal view returns (uint256) {
        if (sDAIBalance == 0) return 0;
        
        // sDAI -> DAI
        uint256 daiValue = sDAI.convertToAssets(sDAIBalance);
        
        // DAI -> USDC (assuming 1:1 for view, actual swap may differ)
        return _daiToUsdc(daiValue);
    }

    function _swapUSDCtoDAI(uint256 amountIn) internal returns (uint256 amountOut) {
        uint256 expectedOut = _usdcToDai(amountIn);
        uint256 minOut = (expectedOut * (BASIS_POINTS - maxSlippage)) / BASIS_POINTS;

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: address(dai),
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        amountOut = swapRouter.exactInputSingle(params);
        emit SwapExecuted(address(usdc), address(dai), amountIn, amountOut);
    }

    function _swapDAItoUSDC(uint256 amountIn) internal returns (uint256 amountOut) {
        uint256 expectedOut = _daiToUsdc(amountIn);
        uint256 minOut = (expectedOut * (BASIS_POINTS - maxSlippage)) / BASIS_POINTS;

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(dai),
            tokenOut: address(usdc),
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        amountOut = swapRouter.exactInputSingle(params);
        emit SwapExecuted(address(dai), address(usdc), amountIn, amountOut);
    }

    function _usdcToDai(uint256 usdcAmount) internal pure returns (uint256) {
        // USDC has 6 decimals, DAI has 18
        return usdcAmount * 10**(DAI_DECIMALS - USDC_DECIMALS);
    }

    function _daiToUsdc(uint256 daiAmount) internal pure returns (uint256) {
        return daiAmount / 10**(DAI_DECIMALS - USDC_DECIMALS);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    function setMaxSlippage(uint256 _maxSlippage) external onlyOwner {
        require(_maxSlippage <= 500, "Slippage too high"); // Max 5%
        maxSlippage = _maxSlippage;
    }

    function setPoolFee(uint24 _poolFee) external onlyOwner {
        poolFee = _poolFee;
    }

    function resetEmergencyMode() external onlyOwner {
        emergencyMode = false;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(usdc) && token != address(dai) && token != address(sDAI), "Cannot rescue strategy tokens");
        IERC20(token).safeTransfer(owner(), amount);
    }
}

// ============================================================================
// INTERFACES
// ============================================================================

interface IERC4626 {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
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
