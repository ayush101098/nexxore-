/**
 * Nexxore Risk Score API
 * Calculates real-time DeFi risk scores for connected wallets
 * 
 * Fetches positions from:
 * - Lending protocols (Aave, Compound)
 * - Perpetuals (dYdX, GMX, Hyperliquid)
 * - Yield farming (Curve, Uniswap)
 * - Staking positions
 * 
 * Returns risk score (0-100) with breakdown
 */

const fetch = require('node-fetch');

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const DEFI_LLAMA_API = 'https://api.llama.fi';

// Market volatility cache (updates hourly)
let volatilityCache = {};
const VOLATILITY_TTL = 3600000; // 1 hour

/**
 * Fetch current market volatility for risk calculations
 */
async function getMarketVolatility() {
  const now = Date.now();
  const cacheKey = 'market_volatility';
  
  if (volatilityCache[cacheKey] && now - volatilityCache[cacheKey].timestamp < VOLATILITY_TTL) {
    return volatilityCache[cacheKey].data;
  }

  try {
    // Fetch 30-day volatility from CoinGecko
    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true`
    );
    const data = await res.json();
    
    volatilityCache[cacheKey] = {
      data: {
        btcVol: 0.04, // Placeholder: 4% daily (realistic for BTC)
        ethVol: 0.05, // 5% daily (realistic for ETH)
        timestamp: now
      },
      timestamp: now
    };
    
    return volatilityCache[cacheKey].data;
  } catch (err) {
    console.error('Failed to fetch market volatility:', err);
    return { btcVol: 0.04, ethVol: 0.05 }; // Fallback
  }
}

/**
 * Parse Aave positions from subgraph data
 */
async function getAavePositions(address) {
  try {
    // In production, query Aave subgraph
    // For now, return mock data
    return {
      deposits: [],
      borrows: [],
      supplyUSD: 0,
      borrowUSD: 0,
      collateralRatio: null
    };
  } catch (err) {
    console.error('Failed to fetch Aave positions:', err);
    return { deposits: [], borrows: [], supplyUSD: 0, borrowUSD: 0 };
  }
}

/**
 * Parse perpetual positions from exchange APIs
 */
async function getPerpetualPositions(address) {
  try {
    // In production, query dYdX/GMX/Hyperliquid APIs
    // For now, return mock data
    return {
      positions: [],
      totalNotional: 0,
      totalLeverage: 1,
      fundingCosts: 0
    };
  } catch (err) {
    console.error('Failed to fetch perpetual positions:', err);
    return { positions: [], totalNotional: 0, totalLeverage: 1 };
  }
}

/**
 * Parse LP positions (Curve, Uniswap)
 */
async function getLPPositions(address) {
  try {
    // In production, query subgraphs or block explorer
    return {
      pools: [],
      totalValue: 0,
      ILExposure: 0
    };
  } catch (err) {
    console.error('Failed to fetch LP positions:', err);
    return { pools: [], totalValue: 0 };
  }
}

/**
 * Aggregate all positions and calculate contribution to risk
 */
async function aggregatePositions(address, chain = 'ethereum') {
  const [aaveData, perpData, lpData] = await Promise.all([
    getAavePositions(address),
    getPerpetualPositions(address),
    getLPPositions(address)
  ]);

  const positions = [];
  let totalRiskValue = 0;

  // Add lending positions
  if (aaveData.borrowUSD > 0) {
    const borrowRisk = aaveData.borrowUSD / (aaveData.collateralRatio || 1);
    positions.push({
      type: 'lending',
      protocol: 'Aave',
      value: aaveData.borrowUSD,
      riskValue: borrowRisk,
      status: aaveData.collateralRatio > 1.5 ? 'safe' : 'warning'
    });
    totalRiskValue += borrowRisk;
  }

  // Add perpetual positions
  if (perpData.positions.length > 0) {
    perpData.positions.forEach(pos => {
      const posRisk = pos.notional * (1 / pos.leverage);
      positions.push({
        type: 'perpetual',
        protocol: pos.exchange,
        value: pos.notional,
        leverage: pos.leverage,
        liquidationDistance: (1 / pos.leverage) * 100,
        riskValue: posRisk,
        status: pos.liquidationDistance > 20 ? 'safe' : 'warning'
      });
      totalRiskValue += posRisk;
    });
  }

  // Add LP positions (impermanent loss risk)
  if (lpData.pools.length > 0) {
    const lpRisk = lpData.ILExposure * 0.1; // IL weighted at 10%
    positions.push({
      type: 'lp',
      protocol: 'Various',
      value: lpData.totalValue,
      ilExposure: lpData.ILExposure,
      riskValue: lpRisk,
      status: 'info'
    });
    totalRiskValue += lpRisk;
  }

  return { positions, totalRiskValue };
}

/**
 * Calculate risk score (0-100) from aggregated positions
 */
function calculateRiskScore(positions, totalRiskValue, marketVol) {
  if (positions.length === 0) return 0;

  // Risk score components
  let score = 0;

  positions.forEach(pos => {
    const contribution = pos.riskValue / Math.max(totalRiskValue, 1);

    if (pos.type === 'perpetual') {
      // Perpetuals are high risk
      // Risk = contribution * leverage * market_vol * 100
      const perpRisk = contribution * (pos.leverage || 1) * (marketVol.ethVol || 0.05) * 100;
      score += Math.min(perpRisk, 40); // Cap at 40 points
    } else if (pos.type === 'lending') {
      // Lending risk based on liquidation distance
      const lendingRisk = contribution * (1 - (pos.collateralRatio || 2) / 3) * 30;
      score += Math.max(0, lendingRisk);
    } else if (pos.type === 'lp') {
      // LP risk from impermanent loss
      const lpRisk = contribution * (pos.ilExposure || 0) * 20;
      score += lpRisk;
    }
  });

  // Normalize to 0-100
  return Math.min(Math.round(score), 100);
}

/**
 * Calculate position risk contribution percentages
 */
function calculateContributions(positions, totalRiskValue) {
  return positions.map(pos => ({
    ...pos,
    contribution: Math.round((pos.riskValue / Math.max(totalRiskValue, 1)) * 100)
  }));
}

/**
 * Determine risk status and recommendation
 */
function getRiskStatus(score) {
  if (score < 30) return { status: 'safe', color: 'green', action: 'Monitor position' };
  if (score < 50) return { status: 'moderate', color: 'yellow', action: 'Consider reducing exposure' };
  if (score < 70) return { status: 'elevated', color: 'orange', action: 'Reduce risky positions' };
  return { status: 'critical', color: 'red', action: 'Immediate action needed' };
}

/**
 * Main API handler
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { address, chain = 'ethereum' } = req.body || req.query;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: 'Invalid Ethereum address' });
      return;
    }

    // Fetch market volatility
    const marketVol = await getMarketVolatility();

    // Aggregate positions from all protocols
    const { positions, totalRiskValue } = await aggregatePositions(address, chain);

    // Calculate risk score
    const riskScore = calculateRiskScore(positions, totalRiskValue, marketVol);

    // Get position contributions
    const positionsWithContribution = calculateContributions(positions, totalRiskValue);

    // Get risk status
    const riskStatus = getRiskStatus(riskScore);

    // Sort by contribution
    positionsWithContribution.sort((a, b) => b.contribution - a.contribution);

    res.status(200).json({
      address,
      chain,
      riskScore,
      status: riskStatus.status,
      statusColor: riskStatus.color,
      recommendation: riskStatus.action,
      positions: positionsWithContribution,
      topRisk: positionsWithContribution[0] || null,
      totalPositions: positions.length,
      market: {
        regime: marketVol.regime || 'risk-on',
        volatility: Math.round((marketVol.ethVol || 0.05) * 100) / 100
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Risk score calculation error:', err);
    res.status(500).json({
      error: 'Failed to calculate risk score',
      message: err.message
    });
  }
};
