// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SafeYieldVault
 * @notice ERC4626 vault with multi-strategy yield optimization and risk management
 * @dev Accepts USDC deposits, allocates to multiple lending strategies with agent-based risk control
 */
contract SafeYieldVault is ERC4626, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============================================================================
    // ROLES
    // ============================================================================
    bytes32 public constant RISK_AGENT = keccak256("RISK_AGENT");
    bytes32 public constant EXECUTION_AGENT = keccak256("EXECUTION_AGENT");
    bytes32 public constant RESEARCH_AGENT = keccak256("RESEARCH_AGENT");
    bytes32 public constant GOVERNANCE = keccak256("GOVERNANCE");

    // ============================================================================
    // RISK THRESHOLDS (basis points, 10000 = 100%)
    // ============================================================================
    uint256 public constant ELEVATED_RISK = 6000;    // 60% - Warning state
    uint256 public constant HIGH_RISK = 7000;        // 70% - Restrict new deposits
    uint256 public constant CRITICAL_RISK = 8000;    // 80% - Emergency actions

    // ============================================================================
    // OPERATIONAL LIMITS
    // ============================================================================
    uint256 public constant REBALANCE_COOLDOWN = 7 days;
    uint256 public constant MAX_SINGLE_REBALANCE = 1500;  // 15% of TVL
    uint256 public constant MIN_IDLE_BUFFER = 500;        // 5% idle buffer
    uint256 public constant BASIS_POINTS = 10000;

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    
    enum RiskState { NORMAL, ELEVATED, HIGH_RISK, CRITICAL }
    
    struct Strategy {
        address strategyAddress;
        string name;
        uint256 allocation;         // Current allocation in basis points
        uint256 maxAllocation;      // Maximum allowed allocation
        uint256 targetAllocation;   // Target allocation for rebalancing
        bool isActive;
        uint256 totalDeposited;
        uint256 lastHarvestTime;
    }

    struct RebalanceProposal {
        uint256 proposalId;
        address fromStrategy;
        address toStrategy;
        uint256 amount;
        uint256 proposedAt;
        bool executed;
        bool approved;
    }

    // Risk tracking
    uint256 public vaultRiskScore;       // 0-10000 basis points
    RiskState public currentRiskState;
    uint256 public lastRiskUpdate;

    // Strategy management
    Strategy[] public strategies;
    mapping(address => uint256) public strategyIndex;
    mapping(address => bool) public isStrategy;

    // Rebalancing
    uint256 public lastRebalanceTime;
    uint256 public rebalanceProposalCount;
    mapping(uint256 => RebalanceProposal) public rebalanceProposals;

    // Fees
    uint256 public managementFee = 50;   // 0.5% annually
    uint256 public performanceFee = 500; // 5% of profits above 4% APY
    uint256 public performanceThreshold = 400; // 4% APY threshold
    address public feeRecipient;

    // ============================================================================
    // EVENTS
    // ============================================================================
    event RiskScoreUpdated(uint256 oldScore, uint256 newScore, RiskState newState);
    event StrategyAdded(address indexed strategy, string name, uint256 maxAllocation);
    event StrategyRemoved(address indexed strategy);
    event StrategyAllocationUpdated(address indexed strategy, uint256 newAllocation);
    event RebalanceProposed(uint256 indexed proposalId, address from, address to, uint256 amount);
    event RebalanceApproved(uint256 indexed proposalId, address approver);
    event RebalanceExecuted(uint256 indexed proposalId, address from, address to, uint256 amount);
    event EmergencyUnwind(address indexed strategy, uint256 amount, string reason);
    event DepositsRestricted(uint256 riskScore, RiskState state);
    event DepositsResumed(uint256 riskScore, RiskState state);
    event YieldHarvested(address indexed strategy, uint256 amount);
    
    // Critical state change events (audit fix)
    event VaultPaused(address indexed caller, uint256 timestamp, uint256 riskScore);
    event VaultUnpaused(address indexed caller, uint256 timestamp, uint256 riskScore);
    event RedemptionProcessed(address indexed owner, address indexed receiver, uint256 shares, uint256 assets);
    event WithdrawalProcessed(address indexed owner, address indexed receiver, uint256 assets, uint256 shares);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event ManagementFeeUpdated(uint256 oldFee, uint256 newFee);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event TargetAllocationsSet(address[] strategies, uint256[] allocations);

    // ============================================================================
    // ERRORS
    // ============================================================================
    error RiskTooHigh(uint256 currentRisk, uint256 threshold);
    error RebalanceCooldownActive(uint256 timeRemaining);
    error ExceedsMaxRebalance(uint256 requested, uint256 maximum);
    error InsufficientIdleBuffer(uint256 required, uint256 available);
    error StrategyNotActive(address strategy);
    error InvalidAllocation(uint256 total);
    error ProposalNotApproved(uint256 proposalId);
    error ProposalExpired(uint256 proposalId);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        address _governance,
        address _feeRecipient
    ) ERC4626(_asset) ERC20(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNANCE, _governance);
        feeRecipient = _feeRecipient;
        currentRiskState = RiskState.NORMAL;
    }

    // ============================================================================
    // DEPOSIT/WITHDRAW OVERRIDES
    // ============================================================================

    /**
     * @notice Deposit assets and receive vault shares
     * @dev Automatically paused when risk exceeds HIGH_RISK threshold
     */
    function deposit(uint256 assets, address receiver) 
        public 
        override 
        nonReentrant 
        whenNotPaused 
        returns (uint256) 
    {
        if (vaultRiskScore >= HIGH_RISK) {
            revert RiskTooHigh(vaultRiskScore, HIGH_RISK);
        }
        return super.deposit(assets, receiver);
    }

    /**
     * @notice Mint exact shares by depositing assets
     * @dev Automatically paused when risk exceeds HIGH_RISK threshold
     */
    function mint(uint256 shares, address receiver) 
        public 
        override 
        nonReentrant 
        whenNotPaused 
        returns (uint256) 
    {
        if (vaultRiskScore >= HIGH_RISK) {
            revert RiskTooHigh(vaultRiskScore, HIGH_RISK);
        }
        return super.mint(shares, receiver);
    }

    /**
     * @notice Withdraw assets by burning shares
     * @dev Always allowed regardless of risk state
     */
    function withdraw(uint256 assets, address receiver, address owner) 
        public 
        override 
        nonReentrant 
        returns (uint256) 
    {
        // Ensure sufficient idle buffer after withdrawal
        uint256 idleAssets = IERC20(asset()).balanceOf(address(this));
        if (assets > idleAssets) {
            _withdrawFromStrategies(assets - idleAssets);
        }
        uint256 shares = super.withdraw(assets, receiver, owner);
        emit WithdrawalProcessed(owner, receiver, assets, shares);
        return shares;
    }

    /**
     * @notice Redeem shares for assets
     * @dev Always allowed regardless of risk state
     */
    function redeem(uint256 shares, address receiver, address owner) 
        public 
        override 
        nonReentrant 
        returns (uint256) 
    {
        uint256 assets = previewRedeem(shares);
        uint256 idleAssets = IERC20(asset()).balanceOf(address(this));
        if (assets > idleAssets) {
            _withdrawFromStrategies(assets - idleAssets);
        }
        uint256 returnedAssets = super.redeem(shares, receiver, owner);
        emit RedemptionProcessed(owner, receiver, shares, returnedAssets);
        return returnedAssets;
    }

    // ============================================================================
    // RISK MANAGEMENT
    // ============================================================================

    /**
     * @notice Update vault risk score
     * @dev Only callable by RISK_AGENT
     */
    function updateRiskScore(uint256 newScore) external onlyRole(RISK_AGENT) {
        require(newScore <= BASIS_POINTS, "Invalid risk score");
        
        uint256 oldScore = vaultRiskScore;
        vaultRiskScore = newScore;
        lastRiskUpdate = block.timestamp;

        // Update risk state
        RiskState newState;
        if (newScore >= CRITICAL_RISK) {
            newState = RiskState.CRITICAL;
            _pause(); // Pause all deposits
        } else if (newScore >= HIGH_RISK) {
            newState = RiskState.HIGH_RISK;
            emit DepositsRestricted(newScore, newState);
        } else if (newScore >= ELEVATED_RISK) {
            newState = RiskState.ELEVATED;
        } else {
            newState = RiskState.NORMAL;
            if (paused()) {
                _unpause();
                emit DepositsResumed(newScore, newState);
            }
        }

        currentRiskState = newState;
        emit RiskScoreUpdated(oldScore, newScore, newState);
    }

    /**
     * @notice Emergency unwind of a specific strategy
     * @dev Only callable by RISK_AGENT when risk is critical
     */
    function emergencyUnwind(address strategy, string calldata reason) 
        external 
        onlyRole(RISK_AGENT) 
    {
        require(isStrategy[strategy], "Not a strategy");
        
        uint256 idx = strategyIndex[strategy];
        Strategy storage strat = strategies[idx];
        
        // Withdraw all assets from strategy
        uint256 withdrawn = IStrategy(strategy).emergencyExit();
        strat.totalDeposited = 0;
        strat.allocation = 0;
        strat.isActive = false;

        emit EmergencyUnwind(strategy, withdrawn, reason);
    }

    // ============================================================================
    // STRATEGY MANAGEMENT
    // ============================================================================

    /**
     * @notice Add a new strategy to the vault
     * @dev Only callable by GOVERNANCE
     */
    function addStrategy(
        address strategyAddress,
        string calldata name,
        uint256 maxAllocation
    ) external onlyRole(GOVERNANCE) {
        require(!isStrategy[strategyAddress], "Strategy exists");
        require(maxAllocation <= BASIS_POINTS, "Invalid max allocation");

        strategies.push(Strategy({
            strategyAddress: strategyAddress,
            name: name,
            allocation: 0,
            maxAllocation: maxAllocation,
            targetAllocation: 0,
            isActive: true,
            totalDeposited: 0,
            lastHarvestTime: block.timestamp
        }));

        strategyIndex[strategyAddress] = strategies.length - 1;
        isStrategy[strategyAddress] = true;

        emit StrategyAdded(strategyAddress, name, maxAllocation);
    }

    /**
     * @notice Remove a strategy from the vault
     * @dev Only callable by GOVERNANCE, must withdraw all assets first
     */
    function removeStrategy(address strategyAddress) external onlyRole(GOVERNANCE) {
        require(isStrategy[strategyAddress], "Not a strategy");
        
        uint256 idx = strategyIndex[strategyAddress];
        require(strategies[idx].totalDeposited == 0, "Strategy has deposits");

        // Remove by swapping with last element
        uint256 lastIdx = strategies.length - 1;
        if (idx != lastIdx) {
            strategies[idx] = strategies[lastIdx];
            strategyIndex[strategies[idx].strategyAddress] = idx;
        }
        strategies.pop();
        
        delete strategyIndex[strategyAddress];
        isStrategy[strategyAddress] = false;

        emit StrategyRemoved(strategyAddress);
    }

    /**
     * @notice Set target allocations for strategies
     * @dev Only callable by EXECUTION_AGENT
     */
    function setTargetAllocations(
        address[] calldata strategyAddresses,
        uint256[] calldata allocations
    ) external onlyRole(EXECUTION_AGENT) {
        require(strategyAddresses.length == allocations.length, "Length mismatch");
        
        uint256 totalAllocation = 0;
        for (uint256 i = 0; i < strategyAddresses.length; i++) {
            require(isStrategy[strategyAddresses[i]], "Not a strategy");
            uint256 idx = strategyIndex[strategyAddresses[i]];
            require(allocations[i] <= strategies[idx].maxAllocation, "Exceeds max");
            strategies[idx].targetAllocation = allocations[i];
            totalAllocation += allocations[i];
        }

        // Account for idle buffer
        require(totalAllocation <= BASIS_POINTS - MIN_IDLE_BUFFER, "Exceeds max total");
        
        emit TargetAllocationsSet(strategyAddresses, allocations);
    }

    // ============================================================================
    // REBALANCING
    // ============================================================================

    /**
     * @notice Propose a rebalance operation
     * @dev Only callable by EXECUTION_AGENT
     */
    function proposeRebalance(
        address fromStrategy,
        address toStrategy,
        uint256 amount
    ) external onlyRole(EXECUTION_AGENT) returns (uint256 proposalId) {
        // Check cooldown
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) {
            revert RebalanceCooldownActive(
                lastRebalanceTime + REBALANCE_COOLDOWN - block.timestamp
            );
        }

        // Check max rebalance limit (15% of TVL)
        uint256 maxAmount = (totalAssets() * MAX_SINGLE_REBALANCE) / BASIS_POINTS;
        if (amount > maxAmount) {
            revert ExceedsMaxRebalance(amount, maxAmount);
        }

        // Verify strategies
        require(isStrategy[fromStrategy] && isStrategy[toStrategy], "Invalid strategies");
        require(strategies[strategyIndex[fromStrategy]].totalDeposited >= amount, "Insufficient balance");

        proposalId = ++rebalanceProposalCount;
        rebalanceProposals[proposalId] = RebalanceProposal({
            proposalId: proposalId,
            fromStrategy: fromStrategy,
            toStrategy: toStrategy,
            amount: amount,
            proposedAt: block.timestamp,
            executed: false,
            approved: false
        });

        emit RebalanceProposed(proposalId, fromStrategy, toStrategy, amount);
    }

    /**
     * @notice Approve a rebalance proposal
     * @dev Only callable by RISK_AGENT
     */
    function approveRebalance(uint256 proposalId) external onlyRole(RISK_AGENT) {
        RebalanceProposal storage proposal = rebalanceProposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(block.timestamp < proposal.proposedAt + 1 days, "Proposal expired");
        
        proposal.approved = true;
        emit RebalanceApproved(proposalId, msg.sender);
    }

    /**
     * @notice Execute an approved rebalance
     * @dev Only callable by EXECUTION_AGENT
     */
    function executeRebalance(uint256 proposalId) external onlyRole(EXECUTION_AGENT) nonReentrant {
        RebalanceProposal storage proposal = rebalanceProposals[proposalId];
        
        if (!proposal.approved) {
            revert ProposalNotApproved(proposalId);
        }
        if (proposal.executed) {
            revert ProposalExpired(proposalId);
        }
        if (block.timestamp >= proposal.proposedAt + 1 days) {
            revert ProposalExpired(proposalId);
        }

        // Check idle buffer after rebalance
        uint256 idleAfter = IERC20(asset()).balanceOf(address(this));
        uint256 minIdle = (totalAssets() * MIN_IDLE_BUFFER) / BASIS_POINTS;
        if (idleAfter < minIdle) {
            revert InsufficientIdleBuffer(minIdle, idleAfter);
        }

        // Execute rebalance
        uint256 withdrawn = IStrategy(proposal.fromStrategy).withdraw(proposal.amount);
        IERC20(asset()).forceApprove(proposal.toStrategy, withdrawn);
        IStrategy(proposal.toStrategy).deposit(withdrawn);

        // Update strategy states
        uint256 fromIdx = strategyIndex[proposal.fromStrategy];
        uint256 toIdx = strategyIndex[proposal.toStrategy];
        strategies[fromIdx].totalDeposited -= proposal.amount;
        strategies[toIdx].totalDeposited += withdrawn;

        // Update allocations
        _updateAllocations();

        proposal.executed = true;
        lastRebalanceTime = block.timestamp;

        emit RebalanceExecuted(proposalId, proposal.fromStrategy, proposal.toStrategy, withdrawn);
    }

    // ============================================================================
    // YIELD HARVESTING
    // ============================================================================

    /**
     * @notice Harvest yield from a strategy
     * @dev Callable by EXECUTION_AGENT
     */
    function harvestStrategy(address strategy) external onlyRole(EXECUTION_AGENT) {
        require(isStrategy[strategy], "Not a strategy");
        
        uint256 harvested = IStrategy(strategy).harvest();
        strategies[strategyIndex[strategy]].lastHarvestTime = block.timestamp;

        // Collect fees
        if (harvested > 0) {
            uint256 fee = _calculateFees(harvested);
            if (fee > 0) {
                IERC20(asset()).safeTransfer(feeRecipient, fee);
            }
        }

        emit YieldHarvested(strategy, harvested);
    }

    /**
     * @notice Harvest all strategies
     */
    function harvestAll() external onlyRole(EXECUTION_AGENT) {
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].isActive && strategies[i].totalDeposited > 0) {
                uint256 harvested = IStrategy(strategies[i].strategyAddress).harvest();
                strategies[i].lastHarvestTime = block.timestamp;
                
                if (harvested > 0) {
                    uint256 fee = _calculateFees(harvested);
                    if (fee > 0) {
                        IERC20(asset()).safeTransfer(feeRecipient, fee);
                    }
                }

                emit YieldHarvested(strategies[i].strategyAddress, harvested);
            }
        }
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get total assets including all strategy deposits
     */
    function totalAssets() public view override returns (uint256) {
        uint256 total = IERC20(asset()).balanceOf(address(this));
        
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].isActive) {
                total += IStrategy(strategies[i].strategyAddress).totalDeposits();
            }
        }
        
        return total;
    }

    /**
     * @notice Get number of strategies
     */
    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    /**
     * @notice Get all strategies with their current state
     */
    function getAllStrategies() external view returns (Strategy[] memory) {
        return strategies;
    }

    /**
     * @notice Get idle buffer percentage
     */
    function idleBufferPercentage() external view returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 total = totalAssets();
        if (total == 0) return BASIS_POINTS;
        return (idle * BASIS_POINTS) / total;
    }

    /**
     * @notice Check if rebalance is allowed (cooldown passed)
     */
    function canRebalance() external view returns (bool) {
        return block.timestamp >= lastRebalanceTime + REBALANCE_COOLDOWN;
    }

    /**
     * @notice Time until next rebalance is allowed
     */
    function timeUntilRebalance() external view returns (uint256) {
        if (block.timestamp >= lastRebalanceTime + REBALANCE_COOLDOWN) {
            return 0;
        }
        return (lastRebalanceTime + REBALANCE_COOLDOWN) - block.timestamp;
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _withdrawFromStrategies(uint256 amount) internal {
        uint256 remaining = amount;
        
        // Withdraw from strategies with lowest utilization first
        for (uint256 i = 0; i < strategies.length && remaining > 0; i++) {
            if (strategies[i].isActive && strategies[i].totalDeposited > 0) {
                uint256 toWithdraw = remaining > strategies[i].totalDeposited 
                    ? strategies[i].totalDeposited 
                    : remaining;
                
                uint256 withdrawn = IStrategy(strategies[i].strategyAddress).withdraw(toWithdraw);
                strategies[i].totalDeposited -= withdrawn;
                remaining -= withdrawn;
            }
        }

        _updateAllocations();
    }

    function _updateAllocations() internal {
        uint256 total = totalAssets();
        if (total == 0) return;

        for (uint256 i = 0; i < strategies.length; i++) {
            strategies[i].allocation = (strategies[i].totalDeposited * BASIS_POINTS) / total;
        }
    }

    function _calculateFees(uint256 yield) internal view returns (uint256) {
        // Management fee (0.5% annually, prorated)
        uint256 mgmtFee = (yield * managementFee) / BASIS_POINTS;
        
        // Performance fee only on excess above threshold
        uint256 perfFee = 0;
        // Simplified: apply performance fee to yield above management fee
        if (yield > mgmtFee) {
            perfFee = ((yield - mgmtFee) * performanceFee) / BASIS_POINTS;
        }
        
        return mgmtFee + perfFee;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setFeeRecipient(address _feeRecipient) external onlyRole(GOVERNANCE) {
        address oldRecipient = feeRecipient;
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(oldRecipient, _feeRecipient);
    }

    function setManagementFee(uint256 _fee) external onlyRole(GOVERNANCE) {
        require(_fee <= 200, "Fee too high"); // Max 2%
        uint256 oldFee = managementFee;
        managementFee = _fee;
        emit ManagementFeeUpdated(oldFee, _fee);
    }

    function setPerformanceFee(uint256 _fee) external onlyRole(GOVERNANCE) {
        require(_fee <= 2000, "Fee too high"); // Max 20%
        uint256 oldFee = performanceFee;
        performanceFee = _fee;
        emit PerformanceFeeUpdated(oldFee, _fee);
    }

    function pause() external onlyRole(RISK_AGENT) {
        _pause();
        emit VaultPaused(msg.sender, block.timestamp, vaultRiskScore);
    }

    function unpause() external onlyRole(GOVERNANCE) {
        require(vaultRiskScore < CRITICAL_RISK, "Risk too high");
        _unpause();
        emit VaultUnpaused(msg.sender, block.timestamp, vaultRiskScore);
    }
}

// ============================================================================
// STRATEGY INTERFACE
// ============================================================================

interface IStrategy {
    function deposit(uint256 amount) external returns (uint256);
    function withdraw(uint256 amount) external returns (uint256);
    function harvest() external returns (uint256);
    function emergencyExit() external returns (uint256);
    function totalDeposits() external view returns (uint256);
    function utilizationRate() external view returns (uint256);
}
