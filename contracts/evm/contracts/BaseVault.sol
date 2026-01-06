// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title BaseVault
 * @notice ERC-4626 compliant vault with multi-strategy support
 * @dev Supports multiple strategies with configurable capital allocation weights
 */
contract BaseVault is ERC4626, AccessControl, ReentrancyGuard, Pausable, Initializable {
    using SafeERC20 for IERC20;

    // ============ Roles ============

    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // ============ State Variables ============

    /// @notice Array of strategy addresses
    address[] public strategies;

    /// @notice Mapping from strategy address to its allocation weight (basis points)
    mapping(address => uint256) public strategyWeights;

    /// @notice Mapping from strategy address to allocated capital
    mapping(address => uint256) public strategyAllocations;

    /// @notice Total weight allocated (should equal 10000 = 100%)
    uint256 public totalWeight;

    /// @notice Maximum number of strategies allowed
    uint256 public constant MAX_STRATEGIES = 10;

    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Maximum allocation per strategy (basis points)
    uint256 public constant MAX_STRATEGY_WEIGHT = 5000; // 50%

    /// @notice Minimum time between rebalances (1 hour)
    uint256 public constant MIN_REBALANCE_INTERVAL = 1 hours;

    /// @notice Last rebalance timestamp
    uint256 public lastRebalance;

    /// @notice Performance fee in basis points (e.g., 200 = 2%)
    uint256 public performanceFee;

    /// @notice Maximum performance fee allowed (10%)
    uint256 public constant MAX_PERFORMANCE_FEE = 1000;

    /// @notice Fee recipient address
    address public feeRecipient;

    // ============ Events ============

    event StrategyAdded(address indexed strategy, uint256 weight);
    event StrategyRemoved(address indexed strategy);
    event StrategyWeightUpdated(address indexed strategy, uint256 oldWeight, uint256 newWeight);
    event CapitalAllocated(address indexed strategy, uint256 amount);
    event CapitalWithdrawn(address indexed strategy, uint256 amount);
    event Rebalanced(uint256 timestamp, uint256 totalAssets);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event EmergencyWithdraw(address indexed strategy, uint256 amount);

    // ============ Errors ============

    error InvalidStrategy();
    error StrategyAlreadyExists();
    error StrategyNotFound();
    error InvalidWeight();
    error TotalWeightExceeded();
    error MaxStrategiesExceeded();
    error InsufficientBalance();
    error RebalanceTooSoon();
    error InvalidFee();
    error ZeroAddress();
    error AlreadyInitialized();

    // ============ Constructor ============

    /**
     * @notice Constructor disabled for proxy pattern
     * @dev Use initialize() instead
     */
    constructor() ERC4626(IERC20(address(0))) ERC20("", "") {
        _disableInitializers();
    }

    // ============ Initialization ============

    /**
     * @notice Initializes the vault (called by factory)
     * @param _asset Underlying asset token
     * @param _name Vault share token name
     * @param _symbol Vault share token symbol
     * @param _owner Vault owner address
     * @param _strategies Initial strategies
     * @param _weights Initial weights (must sum to 10000 or 0)
     */
    function initialize(
        address _asset,
        string memory _name,
        string memory _symbol,
        address _owner,
        address[] memory _strategies,
        uint256[] memory _weights
    ) external initializer {
        if (_asset == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        if (_strategies.length != _weights.length) revert InvalidWeight();
        if (_strategies.length > MAX_STRATEGIES) revert MaxStrategiesExceeded();

        // Initialize ERC4626
        __ERC4626_init(IERC20(_asset));
        __ERC20_init(_name, _symbol);

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(STRATEGIST_ROLE, _owner);
        _grantRole(GUARDIAN_ROLE, _owner);

        // Set fee recipient to owner initially
        feeRecipient = _owner;

        // Add initial strategies
        if (_strategies.length > 0) {
            uint256 weightSum = 0;
            for (uint256 i = 0; i < _strategies.length; i++) {
                if (_strategies[i] == address(0)) revert ZeroAddress();
                if (_weights[i] > MAX_STRATEGY_WEIGHT) revert InvalidWeight();
                
                strategies.push(_strategies[i]);
                strategyWeights[_strategies[i]] = _weights[i];
                weightSum += _weights[i];

                emit StrategyAdded(_strategies[i], _weights[i]);
            }

            if (weightSum != BPS_DENOMINATOR && weightSum != 0) revert InvalidWeight();
            totalWeight = weightSum;
        }

        lastRebalance = block.timestamp;
    }

    // ============ ERC4626 Overrides ============

    /**
     * @notice Deposit assets and receive vault shares
     * @param assets Amount of assets to deposit
     * @param receiver Address to receive shares
     * @return shares Amount of shares minted
     */
    function deposit(uint256 assets, address receiver)
        public
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Mint exact shares by depositing assets
     * @param shares Amount of shares to mint
     * @param receiver Address to receive shares
     * @return assets Amount of assets deposited
     */
    function mint(uint256 shares, address receiver)
        public
        virtual
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Withdraw assets by burning shares
     * @param assets Amount of assets to withdraw
     * @param receiver Address to receive assets
     * @param owner Owner of the shares
     * @return shares Amount of shares burned
     */
    function withdraw(uint256 assets, address receiver, address owner)
        public
        virtual
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.withdraw(assets, receiver, owner);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Redeem shares for assets
     * @param shares Amount of shares to redeem
     * @param receiver Address to receive assets
     * @param owner Owner of the shares
     * @return assets Amount of assets withdrawn
     */
    function redeem(uint256 shares, address receiver, address owner)
        public
        virtual
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.redeem(shares, receiver, owner);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /**
     * @notice Returns total assets including those allocated to strategies
     */
    function totalAssets() public view virtual override returns (uint256) {
        uint256 total = IERC20(asset()).balanceOf(address(this));
        
        // Add allocated capital from all strategies
        for (uint256 i = 0; i < strategies.length; i++) {
            total += strategyAllocations[strategies[i]];
        }
        
        return total;
    }

    // ============ Strategy Management ============

    /**
     * @notice Adds a new strategy with allocation weight
     * @param strategy Strategy contract address
     * @param weight Allocation weight in basis points
     */
    function addStrategy(address strategy, uint256 weight) 
        external 
        onlyRole(STRATEGIST_ROLE) 
    {
        if (strategy == address(0)) revert ZeroAddress();
        if (strategyWeights[strategy] > 0) revert StrategyAlreadyExists();
        if (strategies.length >= MAX_STRATEGIES) revert MaxStrategiesExceeded();
        if (weight > MAX_STRATEGY_WEIGHT) revert InvalidWeight();
        if (totalWeight + weight > BPS_DENOMINATOR) revert TotalWeightExceeded();

        strategies.push(strategy);
        strategyWeights[strategy] = weight;
        totalWeight += weight;

        emit StrategyAdded(strategy, weight);
    }

    /**
     * @notice Removes a strategy (must have zero allocation)
     * @param strategy Strategy address to remove
     */
    function removeStrategy(address strategy) external onlyRole(STRATEGIST_ROLE) {
        if (strategyWeights[strategy] == 0) revert StrategyNotFound();
        if (strategyAllocations[strategy] > 0) revert InsufficientBalance();

        // Remove from array
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i] == strategy) {
                strategies[i] = strategies[strategies.length - 1];
                strategies.pop();
                break;
            }
        }

        totalWeight -= strategyWeights[strategy];
        delete strategyWeights[strategy];

        emit StrategyRemoved(strategy);
    }

    /**
     * @notice Updates a strategy's allocation weight
     * @param strategy Strategy address
     * @param newWeight New weight in basis points
     */
    function updateStrategyWeight(address strategy, uint256 newWeight)
        external
        onlyRole(STRATEGIST_ROLE)
    {
        if (strategyWeights[strategy] == 0) revert StrategyNotFound();
        if (newWeight > MAX_STRATEGY_WEIGHT) revert InvalidWeight();

        uint256 oldWeight = strategyWeights[strategy];
        uint256 newTotalWeight = totalWeight - oldWeight + newWeight;
        
        if (newTotalWeight > BPS_DENOMINATOR) revert TotalWeightExceeded();

        strategyWeights[strategy] = newWeight;
        totalWeight = newTotalWeight;

        emit StrategyWeightUpdated(strategy, oldWeight, newWeight);
    }

    // ============ Capital Allocation ============

    /**
     * @notice Allocates capital to a specific strategy
     * @param strategy Strategy address
     * @param amount Amount to allocate
     */
    function allocateToStrategy(address strategy, uint256 amount)
        external
        onlyRole(STRATEGIST_ROLE)
        nonReentrant
    {
        if (strategyWeights[strategy] == 0) revert StrategyNotFound();
        
        IERC20 _asset = IERC20(asset());
        if (_asset.balanceOf(address(this)) < amount) revert InsufficientBalance();

        strategyAllocations[strategy] += amount;
        _asset.safeTransfer(strategy, amount);

        emit CapitalAllocated(strategy, amount);
    }

    /**
     * @notice Withdraws capital from a strategy back to vault
     * @param strategy Strategy address
     * @param amount Amount to withdraw
     */
    function withdrawFromStrategy(address strategy, uint256 amount)
        external
        onlyRole(STRATEGIST_ROLE)
        nonReentrant
    {
        if (strategyAllocations[strategy] < amount) revert InsufficientBalance();

        strategyAllocations[strategy] -= amount;
        
        // Strategy should implement a withdraw function
        // For now, we assume the strategy transfers back
        // In production, call strategy.withdraw(amount)
        
        emit CapitalWithdrawn(strategy, amount);
    }

    /**
     * @notice Rebalances capital across all strategies based on weights
     */
    function rebalance() external onlyRole(STRATEGIST_ROLE) nonReentrant {
        if (block.timestamp < lastRebalance + MIN_REBALANCE_INTERVAL) {
            revert RebalanceTooSoon();
        }

        uint256 _totalAssets = totalAssets();
        
        // Calculate target allocations
        for (uint256 i = 0; i < strategies.length; i++) {
            address strategy = strategies[i];
            uint256 targetAllocation = (_totalAssets * strategyWeights[strategy]) / BPS_DENOMINATOR;
            uint256 currentAllocation = strategyAllocations[strategy];

            if (targetAllocation > currentAllocation) {
                // Need to allocate more
                uint256 toAllocate = targetAllocation - currentAllocation;
                IERC20 _asset = IERC20(asset());
                
                if (_asset.balanceOf(address(this)) >= toAllocate) {
                    strategyAllocations[strategy] += toAllocate;
                    _asset.safeTransfer(strategy, toAllocate);
                    emit CapitalAllocated(strategy, toAllocate);
                }
            } else if (targetAllocation < currentAllocation) {
                // Need to withdraw
                uint256 toWithdraw = currentAllocation - targetAllocation;
                strategyAllocations[strategy] -= toWithdraw;
                // In production: call strategy.withdraw(toWithdraw)
                emit CapitalWithdrawn(strategy, toWithdraw);
            }
        }

        lastRebalance = block.timestamp;
        emit Rebalanced(block.timestamp, _totalAssets);
    }

    // ============ Fee Management ============

    /**
     * @notice Updates the performance fee
     * @param newFee New fee in basis points
     */
    function setPerformanceFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFee > MAX_PERFORMANCE_FEE) revert InvalidFee();
        
        uint256 oldFee = performanceFee;
        performanceFee = newFee;
        
        emit PerformanceFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Updates the fee recipient address
     * @param newRecipient New fee recipient
     */
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    // ============ Emergency Functions ============

    /**
     * @notice Pauses all deposits and withdrawals
     */
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the vault
     */
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency withdraw from a strategy (guardian only)
     * @param strategy Strategy to withdraw from
     */
    function emergencyWithdraw(address strategy) 
        external 
        onlyRole(GUARDIAN_ROLE) 
        nonReentrant 
    {
        uint256 allocation = strategyAllocations[strategy];
        if (allocation == 0) return;

        strategyAllocations[strategy] = 0;
        
        // In production: call strategy.emergencyWithdraw()
        
        emit EmergencyWithdraw(strategy, allocation);
    }

    // ============ View Functions ============

    /**
     * @notice Returns all strategies
     */
    function getStrategies() external view returns (address[] memory) {
        return strategies;
    }

    /**
     * @notice Returns strategy count
     */
    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    /**
     * @notice Returns detailed strategy info
     * @param strategy Strategy address
     */
    function getStrategyInfo(address strategy)
        external
        view
        returns (
            uint256 weight,
            uint256 allocation,
            uint256 targetAllocation
        )
    {
        weight = strategyWeights[strategy];
        allocation = strategyAllocations[strategy];
        targetAllocation = (totalAssets() * weight) / BPS_DENOMINATOR;
    }

    /**
     * @notice Returns vault idle balance (not allocated to strategies)
     */
    function idleBalance() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }
}
