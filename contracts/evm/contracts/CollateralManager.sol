// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "./NUSD.sol";

/**
 * @title CollateralManager
 * @notice Manages user collateral deposits and nUSD minting
 * @dev Users deposit ETH/tokens → mint nUSD → collateral deployed to strategies
 * 
 * Key Invariant: collateral_value >= nUSD_debt at all times
 */
contract CollateralManager is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    // nUSD token
    NUSD public immutable nusd;

    // Supported collateral tokens (address(0) = ETH)
    mapping(address => bool) public supportedCollateral;
    address[] public collateralTokens;

    // Chainlink price feeds
    mapping(address => AggregatorV3Interface) public priceFeeds;

    // User positions
    struct Position {
        uint256 collateralAmount;    // Amount of collateral deposited
        uint256 nUSDDebt;            // nUSD minted against this collateral
        uint256 lastUpdateTime;      // Last position update
    }

    // user => collateral token => position
    mapping(address => mapping(address => Position)) public positions;

    // Protocol parameters
    uint256 public constant PRECISION = 1e18;
    uint256 public maxLTV = 8000;              // 80% LTV (basis points)
    uint256 public liquidationThreshold = 9000; // 90% (basis points)
    uint256 public liquidationPenalty = 500;    // 5% (basis points)
    uint256 public mintFee = 10;                // 0.1% (basis points)
    uint256 public redeemFee = 10;              // 0.1% (basis points)

    // Strategy router for deploying collateral
    address public strategyRouter;

    // Total protocol stats
    uint256 public totalCollateralValueUSD;
    uint256 public totalNUSDMinted;

    // Events
    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);
    event NUSDMinted(address indexed user, uint256 amount, address indexed collateralToken);
    event NUSDRedeemed(address indexed user, uint256 amount, address indexed collateralToken);
    event Liquidation(address indexed user, address indexed liquidator, uint256 collateralSeized, uint256 debtRepaid);
    event CollateralDeployedToStrategy(address indexed token, uint256 amount);

    constructor(address _nusd) {
        require(_nusd != address(0), "Invalid nUSD address");
        nusd = NUSD(_nusd);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(STRATEGIST_ROLE, msg.sender);
        
        // Add ETH as default collateral
        supportedCollateral[address(0)] = true;
        collateralTokens.push(address(0));
    }

    // ==================== COLLATERAL MANAGEMENT ====================

    /**
     * @notice Deposit ETH as collateral
     */
    function depositETH() external payable nonReentrant whenNotPaused {
        require(msg.value > 0, "Zero deposit");
        require(supportedCollateral[address(0)], "ETH not supported");

        Position storage pos = positions[msg.sender][address(0)];
        pos.collateralAmount += msg.value;
        pos.lastUpdateTime = block.timestamp;

        _updateTotalCollateral();

        emit CollateralDeposited(msg.sender, address(0), msg.value);
    }

    /**
     * @notice Deposit ERC20 token as collateral
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositToken(address token, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Zero deposit");
        require(supportedCollateral[token], "Token not supported");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        Position storage pos = positions[msg.sender][token];
        pos.collateralAmount += amount;
        pos.lastUpdateTime = block.timestamp;

        _updateTotalCollateral();

        emit CollateralDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw collateral (must maintain healthy LTV)
     * @param token Collateral token (address(0) for ETH)
     * @param amount Amount to withdraw
     */
    function withdrawCollateral(address token, uint256 amount) external nonReentrant whenNotPaused {
        Position storage pos = positions[msg.sender][token];
        require(pos.collateralAmount >= amount, "Insufficient collateral");

        // Check if withdrawal maintains healthy position
        uint256 newCollateral = pos.collateralAmount - amount;
        uint256 collateralValueUSD = _getCollateralValueUSD(token, newCollateral);
        
        require(
            pos.nUSDDebt == 0 || collateralValueUSD * 10000 / pos.nUSDDebt >= liquidationThreshold,
            "Would breach liquidation threshold"
        );

        pos.collateralAmount = newCollateral;
        pos.lastUpdateTime = block.timestamp;

        // Transfer collateral back
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        _updateTotalCollateral();

        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    // ==================== nUSD MINTING ====================

    /**
     * @notice Mint nUSD against deposited collateral
     * @param collateralToken Which collateral to mint against
     * @param nUSDAmount Amount of nUSD to mint
     */
    function mintNUSD(address collateralToken, uint256 nUSDAmount) external nonReentrant whenNotPaused {
        require(nUSDAmount > 0, "Zero mint");

        Position storage pos = positions[msg.sender][collateralToken];
        require(pos.collateralAmount > 0, "No collateral deposited");

        // Calculate new debt
        uint256 fee = nUSDAmount * mintFee / 10000;
        uint256 newDebt = pos.nUSDDebt + nUSDAmount + fee;

        // Check LTV
        uint256 collateralValueUSD = _getCollateralValueUSD(collateralToken, pos.collateralAmount);
        uint256 maxMintable = collateralValueUSD * maxLTV / 10000;
        require(newDebt <= maxMintable, "Exceeds max LTV");

        // Update position
        pos.nUSDDebt = newDebt;
        pos.lastUpdateTime = block.timestamp;

        // Mint nUSD to user
        nusd.mint(msg.sender, nUSDAmount);
        
        // Mint fee to protocol
        if (fee > 0) {
            nusd.mint(address(this), fee);
        }

        totalNUSDMinted += nUSDAmount + fee;

        emit NUSDMinted(msg.sender, nUSDAmount, collateralToken);
    }

    /**
     * @notice Redeem nUSD to get collateral back
     * @param collateralToken Which collateral to redeem
     * @param nUSDAmount Amount of nUSD to redeem
     */
    function redeemNUSD(address collateralToken, uint256 nUSDAmount) external nonReentrant whenNotPaused {
        require(nUSDAmount > 0, "Zero redeem");

        Position storage pos = positions[msg.sender][collateralToken];
        require(pos.nUSDDebt >= nUSDAmount, "Exceeds debt");

        // Calculate collateral to return (proportional)
        uint256 collateralToReturn = (pos.collateralAmount * nUSDAmount) / pos.nUSDDebt;
        uint256 fee = collateralToReturn * redeemFee / 10000;
        uint256 netCollateral = collateralToReturn - fee;

        // Update position
        pos.nUSDDebt -= nUSDAmount;
        pos.collateralAmount -= collateralToReturn;
        pos.lastUpdateTime = block.timestamp;

        // Burn nUSD from user
        nusd.burnFrom(msg.sender, nUSDAmount);

        // Return collateral
        if (collateralToken == address(0)) {
            // May need to recall from strategies
            _recallFromStrategies(collateralToken, netCollateral);
            (bool success, ) = msg.sender.call{value: netCollateral}("");
            require(success, "ETH transfer failed");
        } else {
            _recallFromStrategies(collateralToken, netCollateral);
            IERC20(collateralToken).safeTransfer(msg.sender, netCollateral);
        }

        totalNUSDMinted -= nUSDAmount;
        _updateTotalCollateral();

        emit NUSDRedeemed(msg.sender, nUSDAmount, collateralToken);
    }

    // ==================== LIQUIDATIONS ====================

    /**
     * @notice Liquidate an undercollateralized position
     * @param user User to liquidate
     * @param collateralToken Collateral token
     * @param debtToRepay Amount of nUSD debt to repay
     */
    function liquidate(
        address user,
        address collateralToken,
        uint256 debtToRepay
    ) external nonReentrant onlyRole(LIQUIDATOR_ROLE) {
        Position storage pos = positions[user][collateralToken];
        require(pos.nUSDDebt > 0, "No debt");

        // Check if position is liquidatable
        uint256 collateralValueUSD = _getCollateralValueUSD(collateralToken, pos.collateralAmount);
        uint256 currentLTV = (pos.nUSDDebt * 10000) / collateralValueUSD;
        require(currentLTV >= liquidationThreshold, "Position healthy");

        // Calculate collateral to seize (with penalty)
        uint256 debtValueInCollateral = _getCollateralAmount(collateralToken, debtToRepay);
        uint256 penalty = debtValueInCollateral * liquidationPenalty / 10000;
        uint256 totalSeized = debtValueInCollateral + penalty;

        require(totalSeized <= pos.collateralAmount, "Insufficient collateral");

        // Update position
        pos.collateralAmount -= totalSeized;
        pos.nUSDDebt -= debtToRepay;

        // Burn nUSD from liquidator
        nusd.burnFrom(msg.sender, debtToRepay);

        // Transfer collateral to liquidator
        if (collateralToken == address(0)) {
            (bool success, ) = msg.sender.call{value: totalSeized}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(collateralToken).safeTransfer(msg.sender, totalSeized);
        }

        totalNUSDMinted -= debtToRepay;
        _updateTotalCollateral();

        emit Liquidation(user, msg.sender, totalSeized, debtToRepay);
    }

    // ==================== STRATEGY DEPLOYMENT ====================

    /**
     * @notice Deploy idle collateral to yield strategies
     * @param token Collateral token to deploy
     * @param amount Amount to deploy
     */
    function deployToStrategy(address token, uint256 amount) external onlyRole(STRATEGIST_ROLE) {
        require(strategyRouter != address(0), "Strategy router not set");
        
        // Keep minimum reserve for redemptions (20%)
        uint256 totalCollateral = _getTotalCollateral(token);
        uint256 minReserve = totalCollateral * 2000 / 10000;
        uint256 deployable = totalCollateral > minReserve ? totalCollateral - minReserve : 0;
        
        require(amount <= deployable, "Exceeds deployable amount");

        if (token == address(0)) {
            (bool success, ) = strategyRouter.call{value: amount}("");
            require(success, "Deploy failed");
        } else {
            IERC20(token).safeTransfer(strategyRouter, amount);
        }

        emit CollateralDeployedToStrategy(token, amount);
    }

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Get user's position details
     */
    function getPosition(address user, address collateralToken) external view returns (
        uint256 collateralAmount,
        uint256 nUSDDebt,
        uint256 collateralValueUSD,
        uint256 currentLTV,
        uint256 maxMintable,
        bool isLiquidatable
    ) {
        Position memory pos = positions[user][collateralToken];
        collateralAmount = pos.collateralAmount;
        nUSDDebt = pos.nUSDDebt;
        collateralValueUSD = _getCollateralValueUSD(collateralToken, collateralAmount);
        
        if (collateralValueUSD > 0) {
            currentLTV = (nUSDDebt * 10000) / collateralValueUSD;
            maxMintable = (collateralValueUSD * maxLTV / 10000) - nUSDDebt;
            isLiquidatable = currentLTV >= liquidationThreshold;
        }
    }

    /**
     * @notice Get collateral price from Chainlink
     */
    function getCollateralPrice(address token) public view returns (uint256) {
        AggregatorV3Interface feed = priceFeeds[token];
        require(address(feed) != address(0), "No price feed");

        (, int256 price, , , ) = feed.latestRoundData();
        require(price > 0, "Invalid price");

        // Normalize to 18 decimals
        uint8 decimals = feed.decimals();
        return uint256(price) * 10**(18 - decimals);
    }

    // ==================== ADMIN FUNCTIONS ====================

    function addCollateral(address token, address priceFeed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!supportedCollateral[token], "Already supported");
        supportedCollateral[token] = true;
        collateralTokens.push(token);
        priceFeeds[token] = AggregatorV3Interface(priceFeed);
    }

    function setStrategyRouter(address _router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        strategyRouter = _router;
    }

    function setMaxLTV(uint256 _maxLTV) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxLTV <= 9000, "LTV too high");
        maxLTV = _maxLTV;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ==================== INTERNAL FUNCTIONS ====================

    function _getCollateralValueUSD(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 price = getCollateralPrice(token);
        return (amount * price) / PRECISION;
    }

    function _getCollateralAmount(address token, uint256 usdValue) internal view returns (uint256) {
        uint256 price = getCollateralPrice(token);
        return (usdValue * PRECISION) / price;
    }

    function _getTotalCollateral(address token) internal view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    function _updateTotalCollateral() internal {
        uint256 total = 0;
        for (uint i = 0; i < collateralTokens.length; i++) {
            address token = collateralTokens[i];
            uint256 balance = _getTotalCollateral(token);
            total += _getCollateralValueUSD(token, balance);
        }
        totalCollateralValueUSD = total;
    }

    function _recallFromStrategies(address token, uint256 amount) internal {
        // If we don't have enough, recall from strategy router
        uint256 available = _getTotalCollateral(token);
        if (available < amount && strategyRouter != address(0)) {
            // Call strategy router to return funds
            // IStrategyRouter(strategyRouter).recall(token, amount - available);
        }
    }

    // Receive ETH
    receive() external payable {}
}
