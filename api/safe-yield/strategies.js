/**
 * Safe Yield API - Strategies Endpoint
 * Returns detailed strategy information with risk scores
 */

// Risk calculation weights
const RISK_WEIGHTS = {
  protocol: 0.25,
  liquidity: 0.20,
  utilization: 0.25,
  governance: 0.15,
  oracle: 0.15
};

// Calculate composite risk score
function calculateRiskScore(components) {
  return Object.keys(RISK_WEIGHTS).reduce((sum, key) => {
    return sum + (components[key] || 0) * RISK_WEIGHTS[key];
  }, 0);
}

// Strategy definitions
const STRATEGIES = [
  {
    id: 'bluechip-lending',
    name: 'Blue-Chip Lending',
    description: 'Aave, Compound, Morpho',
    icon: '🏦',
    color: ['#3b82f6', '#60a5fa'],
    allocationRange: { min: 40, max: 70 },
    currentAllocation: 0,
    protocols: ['aave', 'compound', 'morpho'],
    
    riskComponents: {
      protocol: 0.10,
      liquidity: 0.12,
      utilization: 0.18,
      governance: 0.08,
      oracle: 0.05
    },
    
    details: {
      whyExists: 'Blue-chip lending protocols represent the most battle-tested DeFi infrastructure. Aave, Compound, and Morpho have collectively processed billions in loans with minimal security incidents. This strategy provides consistent yield through supplying stablecoins to these protocols.',
      whatCanGoWrong: 'Smart contract vulnerabilities, oracle manipulation, extreme market volatility causing utilization spikes, governance attacks, or protocol upgrades introducing bugs. Historical incidents include the Compound oracle issue (2020) and various flash loan exploits on forks.',
      systemResponse: 'If risk score exceeds 0.6, rebalancing freezes. Above 0.7, the strategy enters withdraw-only mode. Above 0.8, emergency unwind triggers automatically. Utilization monitoring alerts at 80%+ and forces gradual exit at 90%+.'
    },
    
    metrics: {
      currentApy: null,
      historicalApy: { avg: 3.8, min: 1.2, max: 8.5 },
      utilizationRate: null,
      availableLiquidity: null
    }
  },
  {
    id: 'maker-sdai',
    name: 'Maker / sDAI',
    description: 'Sky Protocol DSR',
    icon: '💎',
    color: ['#22c55e', '#86efac'],
    allocationRange: { min: 20, max: 40 },
    currentAllocation: 0,
    protocols: ['maker', 'sky'],
    
    riskComponents: {
      protocol: 0.05,
      liquidity: 0.08,
      utilization: 0.02,
      governance: 0.12,
      oracle: 0.03
    },
    
    details: {
      whyExists: 'The DAI Savings Rate (DSR) via sDAI represents one of the safest yield sources in DeFi. It\'s backed by Maker\'s diverse collateral base and has been battle-tested since 2019. The yield comes from protocol revenue, not market speculation.',
      whatCanGoWrong: 'DAI de-peg events, Maker governance decisions reducing DSR to 0%, smart contract risk in the sDAI wrapper, or systemic risk from Maker\'s RWA (Real World Asset) collateral exposure.',
      systemResponse: 'DAI price monitoring triggers alerts at ±0.5% deviation. Automatic reduction begins at ±1% deviation. Full exit triggers at ±2% deviation. Governance vote monitoring for DSR changes with 24-hour advance notice.'
    },
    
    metrics: {
      currentApy: null,
      historicalApy: { avg: 5.0, min: 0, max: 15 },
      dsrRate: null,
      daiPrice: null
    }
  },
  {
    id: 'stable-loop',
    name: 'Conservative Stable Loop',
    description: 'Low-leverage stablecoin optimization',
    icon: '🔄',
    color: ['#9333ea', '#c084fc'],
    allocationRange: { min: 0, max: 20 },
    currentAllocation: 0,
    protocols: ['aave', 'compound'],
    
    riskComponents: {
      protocol: 0.15,
      liquidity: 0.25,
      utilization: 0.40,
      governance: 0.10,
      oracle: 0.08
    },
    
    details: {
      whyExists: 'Provides yield enhancement by recursively supplying and borrowing stablecoins. Despite the name "loop," Safe Yield enforces strict LTV limits (max 40%) and only uses stablecoin pairs, eliminating liquidation risk from price volatility.',
      whatCanGoWrong: 'Stablecoin de-peg creating borrow/supply mismatch, interest rate spikes making the loop unprofitable or creating negative carry, protocol-level issues affecting either side of the position.',
      systemResponse: 'Automatic unwinding begins if supply APY drops below borrow APY for 24 hours. Hard stop if LTV exceeds 45% (5% safety buffer). Full exit on any stablecoin deviation >0.5%. This strategy is optional and may be disabled in v1.'
    },
    
    metrics: {
      currentApy: null,
      historicalApy: { avg: 2.5, min: -0.5, max: 6 },
      currentLtv: null,
      maxLtv: 40,
      spreadApy: null
    }
  },
  {
    id: 'idle',
    name: 'Idle Optimization',
    description: 'Unallocated capital buffer',
    icon: '💤',
    color: ['#6b7280', '#9ca3af'],
    allocationRange: { min: 5, max: 100 },
    currentAllocation: 100,
    protocols: [],
    
    riskComponents: {
      protocol: 0.02,
      liquidity: 0.01,
      utilization: 0.00,
      governance: 0.01,
      oracle: 0.00
    },
    
    details: {
      whyExists: 'Maintains liquidity buffer for withdrawals and emergency rebalancing. Capital held in vault contract or extremely liquid positions. Sacrifices yield for instant availability and minimal smart contract risk.',
      whatCanGoWrong: 'Opportunity cost from uninvested capital. In extreme scenarios, even holding stablecoins carries de-peg risk. Vault contract itself could have vulnerabilities.',
      systemResponse: 'This is the safest position. No active monitoring required. Capital is instantly available for withdrawals or reallocation to other strategies when conditions improve.'
    },
    
    metrics: {
      currentApy: 0,
      historicalApy: { avg: 0, min: 0, max: 0 }
    }
  }
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Enrich strategies with calculated risk scores
    const strategies = STRATEGIES.map(strategy => ({
      ...strategy,
      riskScore: parseFloat(calculateRiskScore(strategy.riskComponents).toFixed(3)),
      riskLevel: getRiskLevel(calculateRiskScore(strategy.riskComponents))
    }));

    res.status(200).json({
      strategies,
      meta: {
        count: strategies.length,
        weights: RISK_WEIGHTS,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching strategies:', err);
    res.status(500).json({ error: err.message });
  }
};

function getRiskLevel(score) {
  if (score < 0.15) return 'very-low';
  if (score < 0.30) return 'low';
  if (score < 0.45) return 'medium';
  if (score < 0.60) return 'elevated';
  if (score < 0.75) return 'high';
  return 'critical';
}
