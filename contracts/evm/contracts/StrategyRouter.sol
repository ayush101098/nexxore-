// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title StrategyRouter
 * @notice Routes collateral to yield-generating strategies
 * @dev Manages capital allocation across multiple strategies
 */
contract StrategyRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Strategy info
    struct Strategy {
        address implementation;     // Strategy contract address
        uint256 weight;            // Allocation weight (basis points)
        uint256 deposited;         // Amount currently deposited
        bool active;               // Is strategy active
        string name;               // Human readable name
    }

    // token => strategies
    mapping(address => Strategy[]) public strategies;
    
    // Collateral manager
    address public collateralManager;

    // Events
    event StrategyAdded(address indexed token, address indexed strategy, string name);
    event StrategyRemoved(address indexed token, uint256 index);
    event CapitalDeployed(address indexed token, address indexed strategy, uint256 amount);
    event CapitalRecalled(address indexed token, address indexed strategy, uint256 amount);
    event Rebalanced(address indexed token);

    constructor(address _collateralManager) {
        collateralManager = _collateralManager;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // ==================== STRATEGY MANAGEMENT ====================

    /**
     * @notice Add a new strategy for a collateral token
     */
    function addStrategy(
        address token,
        address implementation,
        uint256 weight,
        string calldata name
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(implementation != address(0), "Invalid implementation");
        require(weight <= 5000, "Weight too high"); // Max 50% per strategy

        strategies[token].push(Strategy({
            implementation: implementation,
            weight: weight,
            deposited: 0,
            active: true,
            name: name
        }));

        emit StrategyAdded(token, implementation, name);
    }

    /**
     * @notice Remove a strategy (emergency only)
     */
    function removeStrategy(address token, uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < strategies[token].length, "Invalid index");
        
        Strategy storage strat = strategies[token][index];
        
        // Withdraw all funds first
        if (strat.deposited > 0) {
            _withdrawFromStrategy(token, index, strat.deposited);
        }
        
        // Remove strategy
        strategies[token][index] = strategies[token][strategies[token].length - 1];
        strategies[token].pop();

        emit StrategyRemoved(token, index);
    }

    /**
     * @notice Update strategy weight
     */
    function updateWeight(address token, uint256 index, uint256 newWeight) external onlyRole(MANAGER_ROLE) {
        require(index < strategies[token].length, "Invalid index");
        require(newWeight <= 5000, "Weight too high");
        
        strategies[token][index].weight = newWeight;
    }

    // ==================== CAPITAL DEPLOYMENT ====================

    /**
     * @notice Deploy capital to strategies based on weights
     */
    function deployCapital(address token, uint256 amount) external onlyRole(MANAGER_ROLE) nonReentrant {
        require(amount > 0, "Zero amount");
        
        Strategy[] storage strats = strategies[token];
        require(strats.length > 0, "No strategies");

        // Calculate total weight
        uint256 totalWeight = 0;
        for (uint i = 0; i < strats.length; i++) {
            if (strats[i].active) {
                totalWeight += strats[i].weight;
            }
        }
        require(totalWeight > 0, "No active strategies");

        // Deploy to each strategy proportionally
        for (uint i = 0; i < strats.length; i++) {
            if (!strats[i].active) continue;
            
            uint256 allocation = (amount * strats[i].weight) / totalWeight;
            if (allocation > 0) {
                _depositToStrategy(token, i, allocation);
            }
        }
    }

    /**
     * @notice Recall capital from strategies
     */
    function recallCapital(address token, uint256 amount) external nonReentrant {
        require(msg.sender == collateralManager || hasRole(MANAGER_ROLE, msg.sender), "Unauthorized");
        
        Strategy[] storage strats = strategies[token];
        uint256 remaining = amount;

        // Withdraw proportionally from each strategy
        for (uint i = 0; i < strats.length && remaining > 0; i++) {
            if (strats[i].deposited > 0) {
                uint256 toWithdraw = remaining > strats[i].deposited ? strats[i].deposited : remaining;
                _withdrawFromStrategy(token, i, toWithdraw);
                remaining -= toWithdraw;
            }
        }

        // Transfer to collateral manager
        if (token == address(0)) {
            (bool success, ) = collateralManager.call{value: amount - remaining}("");
            require(success, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(collateralManager, amount - remaining);
        }
    }

    /**
     * @notice Rebalance capital according to weights
     */
    function rebalance(address token) external onlyRole(MANAGER_ROLE) nonReentrant {
        Strategy[] storage strats = strategies[token];
        
        // Calculate total deployed
        uint256 totalDeployed = 0;
        uint256 totalWeight = 0;
        
        for (uint i = 0; i < strats.length; i++) {
            if (strats[i].active) {
                totalDeployed += strats[i].deposited;
                totalWeight += strats[i].weight;
            }
        }

        if (totalDeployed == 0 || totalWeight == 0) return;

        // Rebalance each strategy
        for (uint i = 0; i < strats.length; i++) {
            if (!strats[i].active) continue;

            uint256 targetAmount = (totalDeployed * strats[i].weight) / totalWeight;
            uint256 currentAmount = strats[i].deposited;

            if (currentAmount > targetAmount) {
                // Withdraw excess
                _withdrawFromStrategy(token, i, currentAmount - targetAmount);
            } else if (currentAmount < targetAmount) {
                // Deposit more
                _depositToStrategy(token, i, targetAmount - currentAmount);
            }
        }

        emit Rebalanced(token);
    }

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Get total capital deployed for a token
     */
    function getTotalDeployed(address token) external view returns (uint256) {
        uint256 total = 0;
        Strategy[] storage strats = strategies[token];
        
        for (uint i = 0; i < strats.length; i++) {
            total += strats[i].deposited;
        }
        
        return total;
    }

    /**
     * @notice Get all strategies for a token
     */
    function getStrategies(address token) external view returns (Strategy[] memory) {
        return strategies[token];
    }

    // ==================== INTERNAL FUNCTIONS ====================

    function _depositToStrategy(address token, uint256 index, uint256 amount) internal {
        Strategy storage strat = strategies[token][index];
        
        // Approve and deposit to strategy
        if (token != address(0)) {
            IERC20(token).safeApprove(strat.implementation, amount);
        }
        
        // Call strategy deposit (simplified interface)
        // IStrategy(strat.implementation).deposit{value: token == address(0) ? amount : 0}(amount);
        
        strat.deposited += amount;
        
        emit CapitalDeployed(token, strat.implementation, amount);
    }

    function _withdrawFromStrategy(address token, uint256 index, uint256 amount) internal {
        Strategy storage strat = strategies[token][index];
        
        // Call strategy withdraw
        // IStrategy(strat.implementation).withdraw(amount);
        
        strat.deposited -= amount;
        
        emit CapitalRecalled(token, strat.implementation, amount);
    }

    // Receive ETH
    receive() external payable {}
}
