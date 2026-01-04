// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RiskOracle
 * @notice Aggregates risk scores from multiple data sources
 * @dev Composite risk = 25% protocol + 20% liquidity + 25% utilization + 15% governance + 15% oracle
 */
contract RiskOracle is AccessControl {

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    bytes32 public constant RISK_AGENT = keccak256("RISK_AGENT");
    uint256 public constant BASIS_POINTS = 10000;
    
    // Risk weight configuration
    uint256 public constant PROTOCOL_WEIGHT = 2500;     // 25%
    uint256 public constant LIQUIDITY_WEIGHT = 2000;    // 20%
    uint256 public constant UTILIZATION_WEIGHT = 2500;  // 25%
    uint256 public constant GOVERNANCE_WEIGHT = 1500;   // 15%
    uint256 public constant ORACLE_WEIGHT = 1500;       // 15%

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    
    struct RiskMetrics {
        uint256 protocolRisk;       // Smart contract, audit, TVL concentration
        uint256 liquidityRisk;      // Withdrawal liquidity, slippage
        uint256 utilizationRisk;    // Pool utilization rates
        uint256 governanceRisk;     // Governance changes, admin key risks
        uint256 oracleRisk;         // Price feed reliability
        uint256 compositeRisk;      // Weighted average
        uint256 timestamp;
    }

    struct HistoricalRisk {
        uint256 compositeRisk;
        uint256 timestamp;
    }

    // Current metrics
    RiskMetrics public currentMetrics;
    
    // Historical data
    HistoricalRisk[] public riskHistory;
    uint256 public constant MAX_HISTORY = 1000;

    // Per-strategy risk tracking
    mapping(address => RiskMetrics) public strategyRisk;

    // ============================================================================
    // EVENTS
    // ============================================================================
    event RiskScoreUpdated(
        uint256 oldComposite,
        uint256 newComposite,
        uint256 protocol,
        uint256 liquidity,
        uint256 utilization,
        uint256 governance,
        uint256 oracle
    );
    event StrategyRiskUpdated(address indexed strategy, uint256 compositeRisk);
    event RiskAgentUpdated(address indexed agent);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_AGENT, admin);
    }

    // ============================================================================
    // RISK UPDATES
    // ============================================================================

    /**
     * @notice Update all risk metrics
     * @dev Only callable by RISK_AGENT
     */
    function updateRiskMetrics(
        uint256 protocolRisk,
        uint256 liquidityRisk,
        uint256 utilizationRisk,
        uint256 governanceRisk,
        uint256 oracleRisk
    ) external onlyRole(RISK_AGENT) {
        require(protocolRisk <= BASIS_POINTS, "Invalid protocol risk");
        require(liquidityRisk <= BASIS_POINTS, "Invalid liquidity risk");
        require(utilizationRisk <= BASIS_POINTS, "Invalid utilization risk");
        require(governanceRisk <= BASIS_POINTS, "Invalid governance risk");
        require(oracleRisk <= BASIS_POINTS, "Invalid oracle risk");

        uint256 oldComposite = currentMetrics.compositeRisk;

        // Calculate composite risk
        uint256 composite = (
            (protocolRisk * PROTOCOL_WEIGHT) +
            (liquidityRisk * LIQUIDITY_WEIGHT) +
            (utilizationRisk * UTILIZATION_WEIGHT) +
            (governanceRisk * GOVERNANCE_WEIGHT) +
            (oracleRisk * ORACLE_WEIGHT)
        ) / BASIS_POINTS;

        // Update current metrics
        currentMetrics = RiskMetrics({
            protocolRisk: protocolRisk,
            liquidityRisk: liquidityRisk,
            utilizationRisk: utilizationRisk,
            governanceRisk: governanceRisk,
            oracleRisk: oracleRisk,
            compositeRisk: composite,
            timestamp: block.timestamp
        });

        // Store in history
        _addToHistory(composite);

        emit RiskScoreUpdated(
            oldComposite,
            composite,
            protocolRisk,
            liquidityRisk,
            utilizationRisk,
            governanceRisk,
            oracleRisk
        );
    }

    /**
     * @notice Update individual metric
     */
    function updateProtocolRisk(uint256 risk) external onlyRole(RISK_AGENT) {
        require(risk <= BASIS_POINTS, "Invalid risk");
        currentMetrics.protocolRisk = risk;
        _recalculateComposite();
    }

    function updateLiquidityRisk(uint256 risk) external onlyRole(RISK_AGENT) {
        require(risk <= BASIS_POINTS, "Invalid risk");
        currentMetrics.liquidityRisk = risk;
        _recalculateComposite();
    }

    function updateUtilizationRisk(uint256 risk) external onlyRole(RISK_AGENT) {
        require(risk <= BASIS_POINTS, "Invalid risk");
        currentMetrics.utilizationRisk = risk;
        _recalculateComposite();
    }

    function updateGovernanceRisk(uint256 risk) external onlyRole(RISK_AGENT) {
        require(risk <= BASIS_POINTS, "Invalid risk");
        currentMetrics.governanceRisk = risk;
        _recalculateComposite();
    }

    function updateOracleRisk(uint256 risk) external onlyRole(RISK_AGENT) {
        require(risk <= BASIS_POINTS, "Invalid risk");
        currentMetrics.oracleRisk = risk;
        _recalculateComposite();
    }

    /**
     * @notice Update strategy-specific risk
     */
    function updateStrategyRisk(
        address strategy,
        uint256 protocolRisk,
        uint256 liquidityRisk,
        uint256 utilizationRisk,
        uint256 governanceRisk,
        uint256 oracleRisk
    ) external onlyRole(RISK_AGENT) {
        uint256 composite = (
            (protocolRisk * PROTOCOL_WEIGHT) +
            (liquidityRisk * LIQUIDITY_WEIGHT) +
            (utilizationRisk * UTILIZATION_WEIGHT) +
            (governanceRisk * GOVERNANCE_WEIGHT) +
            (oracleRisk * ORACLE_WEIGHT)
        ) / BASIS_POINTS;

        strategyRisk[strategy] = RiskMetrics({
            protocolRisk: protocolRisk,
            liquidityRisk: liquidityRisk,
            utilizationRisk: utilizationRisk,
            governanceRisk: governanceRisk,
            oracleRisk: oracleRisk,
            compositeRisk: composite,
            timestamp: block.timestamp
        });

        emit StrategyRiskUpdated(strategy, composite);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get current composite risk score
     */
    function getCurrentRisk() external view returns (uint256) {
        return currentMetrics.compositeRisk;
    }

    /**
     * @notice Get all current metrics
     */
    function getCurrentMetrics() external view returns (RiskMetrics memory) {
        return currentMetrics;
    }

    /**
     * @notice Get risk breakdown
     */
    function getRiskBreakdown() external view returns (
        uint256 protocol,
        uint256 liquidity,
        uint256 utilization,
        uint256 governance,
        uint256 oracle,
        uint256 composite
    ) {
        return (
            currentMetrics.protocolRisk,
            currentMetrics.liquidityRisk,
            currentMetrics.utilizationRisk,
            currentMetrics.governanceRisk,
            currentMetrics.oracleRisk,
            currentMetrics.compositeRisk
        );
    }

    /**
     * @notice Get strategy risk
     */
    function getStrategyRisk(address strategy) external view returns (RiskMetrics memory) {
        return strategyRisk[strategy];
    }

    /**
     * @notice Get history length
     */
    function getHistoryLength() external view returns (uint256) {
        return riskHistory.length;
    }

    /**
     * @notice Get historical risk score at index
     */
    function getHistoricalRisk(uint256 index) external view returns (HistoricalRisk memory) {
        require(index < riskHistory.length, "Index out of bounds");
        return riskHistory[index];
    }

    /**
     * @notice Get recent history (last n entries)
     */
    function getRecentHistory(uint256 count) external view returns (HistoricalRisk[] memory) {
        uint256 length = riskHistory.length;
        if (count > length) count = length;
        
        HistoricalRisk[] memory recent = new HistoricalRisk[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = riskHistory[length - count + i];
        }
        return recent;
    }

    /**
     * @notice Get average risk over time period
     */
    function getAverageRisk(uint256 periodSeconds) external view returns (uint256) {
        uint256 cutoff = block.timestamp - periodSeconds;
        uint256 sum = 0;
        uint256 count = 0;
        
        for (uint256 i = riskHistory.length; i > 0; i--) {
            if (riskHistory[i - 1].timestamp < cutoff) break;
            sum += riskHistory[i - 1].compositeRisk;
            count++;
        }
        
        if (count == 0) return currentMetrics.compositeRisk;
        return sum / count;
    }

    /**
     * @notice Get max risk over time period
     */
    function getMaxRisk(uint256 periodSeconds) external view returns (uint256) {
        uint256 cutoff = block.timestamp - periodSeconds;
        uint256 maxRisk = currentMetrics.compositeRisk;
        
        for (uint256 i = riskHistory.length; i > 0; i--) {
            if (riskHistory[i - 1].timestamp < cutoff) break;
            if (riskHistory[i - 1].compositeRisk > maxRisk) {
                maxRisk = riskHistory[i - 1].compositeRisk;
            }
        }
        
        return maxRisk;
    }

    /**
     * @notice Check if risk is above threshold
     */
    function isRiskAboveThreshold(uint256 threshold) external view returns (bool) {
        return currentMetrics.compositeRisk >= threshold;
    }

    /**
     * @notice Get time since last update
     */
    function timeSinceLastUpdate() external view returns (uint256) {
        return block.timestamp - currentMetrics.timestamp;
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _recalculateComposite() internal {
        uint256 oldComposite = currentMetrics.compositeRisk;
        
        uint256 composite = (
            (currentMetrics.protocolRisk * PROTOCOL_WEIGHT) +
            (currentMetrics.liquidityRisk * LIQUIDITY_WEIGHT) +
            (currentMetrics.utilizationRisk * UTILIZATION_WEIGHT) +
            (currentMetrics.governanceRisk * GOVERNANCE_WEIGHT) +
            (currentMetrics.oracleRisk * ORACLE_WEIGHT)
        ) / BASIS_POINTS;

        currentMetrics.compositeRisk = composite;
        currentMetrics.timestamp = block.timestamp;

        _addToHistory(composite);

        emit RiskScoreUpdated(
            oldComposite,
            composite,
            currentMetrics.protocolRisk,
            currentMetrics.liquidityRisk,
            currentMetrics.utilizationRisk,
            currentMetrics.governanceRisk,
            currentMetrics.oracleRisk
        );
    }

    function _addToHistory(uint256 risk) internal {
        // Remove oldest if at max
        if (riskHistory.length >= MAX_HISTORY) {
            // Shift array (expensive but maintains order)
            for (uint256 i = 0; i < riskHistory.length - 1; i++) {
                riskHistory[i] = riskHistory[i + 1];
            }
            riskHistory.pop();
        }
        
        riskHistory.push(HistoricalRisk({
            compositeRisk: risk,
            timestamp: block.timestamp
        }));
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function grantRiskAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(RISK_AGENT, agent);
        emit RiskAgentUpdated(agent);
    }

    function revokeRiskAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(RISK_AGENT, agent);
    }
}
