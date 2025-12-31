/**
 * Safe Yield API - Risk Score Endpoint
 * Calculates and returns detailed risk metrics
 */

// Risk calculation formula implementation
const RISK_WEIGHTS = {
  protocol: 0.25,    // w₁ - Protocol safety
  liquidity: 0.20,   // w₂ - Liquidity availability
  utilization: 0.25, // w₃ - Protocol utilization
  governance: 0.15,  // w₄ - Governance activity
  oracle: 0.15       // w₅ - Oracle reliability
};

// Protocol safety scores (inverted: lower = safer)
const PROTOCOL_SCORES = {
  aave: { audits: 12, exploits: 0, yearsActive: 4, tvlStability: 0.95, score: 0.08 },
  compound: { audits: 8, exploits: 1, yearsActive: 5, tvlStability: 0.90, score: 0.12 },
  morpho: { audits: 6, exploits: 0, yearsActive: 2, tvlStability: 0.88, score: 0.15 },
  maker: { audits: 15, exploits: 0, yearsActive: 6, tvlStability: 0.92, score: 0.05 }
};

// Calculate composite risk score
function calculateCompositeRisk(components, weights = RISK_WEIGHTS) {
  let score = 0;
  let totalWeight = 0;
  
  for (const [key, weight] of Object.entries(weights)) {
    if (components[key] !== undefined) {
      score += components[key] * weight;
      totalWeight += weight;
    }
  }
  
  return totalWeight > 0 ? score / totalWeight * Object.keys(weights).length : 0;
}

// Get risk level classification
function getRiskLevel(score) {
  if (score < 0.15) return { level: 'very-low', color: '#22c55e', label: 'Very Low' };
  if (score < 0.30) return { level: 'low', color: '#86efac', label: 'Low' };
  if (score < 0.45) return { level: 'medium', color: '#fbbf24', label: 'Medium' };
  if (score < 0.60) return { level: 'elevated', color: '#f97316', label: 'Elevated' };
  if (score < 0.75) return { level: 'high', color: '#ef4444', label: 'High' };
  return { level: 'critical', color: '#dc2626', label: 'Critical' };
}

// Determine required action based on risk
function getRequiredAction(score) {
  if (score >= 0.8) return { action: 'emergency-unwind', description: 'Emergency unwind triggered', automatic: true };
  if (score >= 0.7) return { action: 'withdraw-only', description: 'Deposits disabled, withdrawals only', automatic: true };
  if (score >= 0.6) return { action: 'freeze-rebalancing', description: 'Rebalancing frozen', automatic: true };
  return { action: 'normal', description: 'Normal operations', automatic: false };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Current strategy risk components (would be live-calculated in production)
    const strategyRisks = {
      'bluechip-lending': {
        protocol: 0.10,
        liquidity: 0.12,
        utilization: 0.18,
        governance: 0.08,
        oracle: 0.05,
        allocation: 0 // 0% when inactive
      },
      'maker-sdai': {
        protocol: 0.05,
        liquidity: 0.08,
        utilization: 0.02,
        governance: 0.12,
        oracle: 0.03,
        allocation: 0
      },
      'stable-loop': {
        protocol: 0.15,
        liquidity: 0.25,
        utilization: 0.40,
        governance: 0.10,
        oracle: 0.08,
        allocation: 0
      },
      'idle': {
        protocol: 0.02,
        liquidity: 0.01,
        utilization: 0.00,
        governance: 0.01,
        oracle: 0.00,
        allocation: 100
      }
    };

    // Calculate individual strategy risk scores
    const strategyScores = {};
    for (const [strategy, components] of Object.entries(strategyRisks)) {
      const { allocation, ...riskComponents } = components;
      strategyScores[strategy] = {
        components: riskComponents,
        compositeScore: calculateCompositeRisk(riskComponents),
        allocation,
        ...getRiskLevel(calculateCompositeRisk(riskComponents))
      };
    }

    // Calculate vault-level risk (weighted by allocation)
    let vaultRisk = 0;
    let totalAllocation = 0;
    
    for (const [strategy, data] of Object.entries(strategyScores)) {
      if (data.allocation > 0) {
        vaultRisk += data.compositeScore * (data.allocation / 100);
        totalAllocation += data.allocation;
      }
    }
    
    // Normalize if allocations don't sum to 100%
    if (totalAllocation > 0 && totalAllocation !== 100) {
      vaultRisk = vaultRisk * (100 / totalAllocation);
    }

    const riskReport = {
      vault: {
        riskScore: parseFloat(vaultRisk.toFixed(4)),
        ...getRiskLevel(vaultRisk),
        requiredAction: getRequiredAction(vaultRisk)
      },
      
      strategies: strategyScores,
      
      thresholds: {
        freezeRebalancing: { trigger: 0.6, status: vaultRisk >= 0.6 ? 'triggered' : 'normal' },
        withdrawOnly: { trigger: 0.7, status: vaultRisk >= 0.7 ? 'triggered' : 'normal' },
        emergencyUnwind: { trigger: 0.8, status: vaultRisk >= 0.8 ? 'triggered' : 'normal' }
      },
      
      weights: RISK_WEIGHTS,
      
      formula: {
        description: 'RiskScore = w₁·Pᵣ + w₂·Lᵣ + w₃·Uᵣ + w₄·Gᵣ + w₅·Oᵣ',
        vaultFormula: 'VaultRisk = Σ (Allocationᵢ × RiskScoreᵢ)',
        components: {
          'Pᵣ': 'Protocol Risk (audit history, exploits, TVL stability)',
          'Lᵣ': 'Liquidity Risk (withdraw demand / available liquidity)',
          'Uᵣ': 'Utilization Risk (current / max safe utilization)',
          'Gᵣ': 'Governance Risk (active proposals, emergency votes)',
          'Oᵣ': 'Oracle Risk (deviations, paused feeds, delays)'
        }
      },
      
      protocols: PROTOCOL_SCORES,
      
      timestamp: new Date().toISOString(),
      nextEvaluation: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    };

    res.status(200).json(riskReport);
  } catch (err) {
    console.error('Risk calculation error:', err);
    res.status(500).json({ error: err.message });
  }
};
