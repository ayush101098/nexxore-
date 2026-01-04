/**
 * Alpha Scanner Module
 * 
 * Scans for tradeable anomalies using free public APIs:
 * - CoinGecko (prices, volume, market data)
 * - DeFiLlama (TVL, protocol metrics, yields)
 * - GitHub API (development activity, commits, contributors)
 * - Coinglass/alternative APIs (funding rates, open interest)
 * 
 * Signal Types:
 * 1. FADE_TRADE: Mean reversion against crowded positioning
 * 2. SQUEEZE_SETUP: Liquidation cascade potential
 * 3. VOL_EXPANSION: Volatility breakout from compression
 * 4. TVL_LAG: Protocol TVL diverging from token price
 * 5. YIELD_SPIKE: APY/APR spike without price response
 * 6. TVL_INFLOW_LEAD: Historical pattern of TVL preceding appreciation
 * 7. DEV_ACTIVITY_LEAD: High GitHub/dev activity with lagging price
 * 8. NARRATIVE_LEAD: Protocol ranking/attention rising, price lagging
 * 
 * Trade Classification:
 * - Directional: Pure long/short based on signal
 * - Yield + Hedge: Capture elevated yield while hedging token exposure
 * - Accumulation: Gradual position building on dev/narrative lead
 */

const { fetchWithTimeout, AgentLogger } = require('../shared/utils');

const logger = new AgentLogger('AlphaScanner');

// Free API endpoints
const APIS = {
  COINGECKO: 'https://api.coingecko.com/api/v3',
  DEFILLAMA: 'https://api.llama.fi',
  DEFILLAMA_COINS: 'https://coins.llama.fi',
  DEFILLAMA_YIELDS: 'https://yields.llama.fi',
  GITHUB: 'https://api.github.com',
  COINGLASS_ALT: 'https://open-api.coinglass.com/public/v2',
  // On-chain data sources
  GLASSNODE_FREE: 'https://api.glassnode.com/v1/metrics',
  BLOCKCHAIN_INFO: 'https://blockchain.info',
  ETHERSCAN_API: 'https://api.etherscan.io/api',
  DUNE_API: 'https://api.dune.com/api/v1'
};

// Assets to scan (liquid perps markets)
const SCAN_ASSETS = [
  { id: 'bitcoin', symbol: 'BTC', defillamaId: null, hasPerps: true },
  { id: 'ethereum', symbol: 'ETH', defillamaId: null, hasPerps: true },
  { id: 'solana', symbol: 'SOL', defillamaId: null, hasPerps: true },
  { id: 'avalanche-2', symbol: 'AVAX', defillamaId: null, hasPerps: true },
  { id: 'arbitrum', symbol: 'ARB', defillamaId: 'arbitrum', hasPerps: true },
  { id: 'optimism', symbol: 'OP', defillamaId: 'optimism', hasPerps: true },
  { id: 'dogecoin', symbol: 'DOGE', defillamaId: null, hasPerps: true },
  { id: 'pepe', symbol: 'PEPE', defillamaId: null, hasPerps: true }
];

// DeFi protocols to scan (with yield-bearing products and GitHub repos)
const SCAN_PROTOCOLS = [
  { slug: 'aave', token: 'aave', name: 'Aave', hasYield: true, yieldType: 'lending', github: 'aave/aave-v3-core' },
  { slug: 'lido', token: 'lido-dao', name: 'Lido', hasYield: true, yieldType: 'staking', github: 'lidofinance/lido-dao' },
  { slug: 'uniswap', token: 'uniswap', name: 'Uniswap', hasYield: true, yieldType: 'lp', github: 'Uniswap/v3-core' },
  { slug: 'curve-dex', token: 'curve-dao-token', name: 'Curve', hasYield: true, yieldType: 'lp', github: 'curvefi/curve-contract' },
  { slug: 'maker', token: 'maker', name: 'Maker', hasYield: true, yieldType: 'lending', github: 'makerdao/dss' },
  { slug: 'eigenlayer', token: 'eigenlayer', name: 'EigenLayer', hasYield: true, yieldType: 'restaking', github: 'Layr-Labs/eigenlayer-contracts' },
  { slug: 'pendle', token: 'pendle', name: 'Pendle', hasYield: true, yieldType: 'yield-trading', github: 'pendle-finance/pendle-core-v2-public' },
  { slug: 'gmx', token: 'gmx', name: 'GMX', hasYield: true, yieldType: 'perps-lp', github: 'gmx-io/gmx-contracts' },
  { slug: 'morpho', token: 'morpho', name: 'Morpho', hasYield: true, yieldType: 'lending', github: 'morpho-org/morpho-blue' },
  { slug: 'ethena', token: 'ethena', name: 'Ethena', hasYield: true, yieldType: 'synthetic', github: 'ethena-labs/ethena' }
];

// ============================================================================
// SIGNAL QUALITY THRESHOLDS - Reject weak/ambiguous signals
// ============================================================================
const SIGNAL_THRESHOLDS = {
  MIN_CONFIDENCE: 45,              // Reject below this
  MIN_VOLUME_RATIO: 0.04,          // Min 4% daily volume/mcap
  MAX_PRICE_NOISE: 0.03,           // Max 3% random noise tolerance
  MIN_DIVERGENCE: 5,               // Min 5% divergence for signal
  MIN_PERSISTENCE_PERIODS: 3,      // Funding must persist 3+ periods
  VOL_COMPRESSION_THRESHOLD: 0.018, // Volatility considered compressed
  EXTREME_PRICE_POSITION: 0.15,    // Top/bottom 15% of range
  SQUEEZE_LEVERAGE_THRESHOLD: 0.12, // Volume/MCap suggesting leverage
  // Yield-specific thresholds
  MIN_YIELD_SPIKE: 25,             // 25% yield increase to trigger signal
  MIN_APY_ABSOLUTE: 5,             // Minimum 5% APY to be interesting
  TVL_INFLOW_THRESHOLD: 8,         // 8% weekly TVL inflow
  TVL_LEAD_LOOKBACK: 30,           // Days to analyze TVL-price relationship
  YIELD_PRICE_LAG_WINDOW: 72,      // Hours of yield spike without price response
  // Dev/Narrative activity thresholds
  MIN_COMMIT_SPIKE: 50,            // 50% increase in commit activity
  MIN_CONTRIBUTOR_GROWTH: 20,      // 20% growth in contributors
  MIN_RANKING_IMPROVEMENT: 5,      // 5 position improvement in rankings
  DEV_PRICE_LAG_THRESHOLD: 3,      // Price moved <3% despite dev activity
  ECOSYSTEM_GROWTH_MIN: 10         // 10% ecosystem growth (TVL + users)
};

// ============================================================================
// ALPHA QUALITY SCORING SYSTEM
// Score = 0.4×Structural + 0.3×Positioning + 0.2×Timing + 0.1×DataConfidence
// ============================================================================

const ALPHA_SCORE_WEIGHTS = {
  STRUCTURAL_EDGE: 0.4,      // Fundamental reason the trade should work
  POSITIONING_ASYMMETRY: 0.3, // Risk/reward profile
  TIMING_CLARITY: 0.2,        // How clear is the timing/catalyst?
  DATA_CONFIDENCE: 0.1        // Quality of underlying data
};

/**
 * Calculate Structural Edge Score (0-100)
 * Measures the fundamental reason why this trade should work
 */
function calculateStructuralEdge(signalType, rawData) {
  let score = 0;
  
  switch (signalType) {
    case 'FADE_TRADE':
      // Edge from crowded positioning at extremes
      const persistence = rawData.persistence || 0;
      const stressScore = rawData.stressScore || 0;
      const pricePosition = rawData.pricePosition || 0.5;
      
      // Persistence of funding direction (max 35)
      score += Math.min(35, persistence * 5);
      // Positioning stress (max 35)
      score += Math.min(35, stressScore * 0.35);
      // Price at extreme (max 30)
      const extremity = Math.abs(pricePosition - 0.5) * 2; // 0-1 scale
      score += extremity * 30;
      break;
      
    case 'SQUEEZE_SETUP':
      // Edge from trapped positions about to liquidate
      const divergence = rawData.fundingDiverged ? 30 : 0;
      const leverageStress = rawData.stressScore || 0;
      
      score += divergence;
      score += Math.min(40, leverageStress * 0.4);
      score += (rawData.volumeRatio || 0) > 0.1 ? 30 : (rawData.volumeRatio || 0) * 200;
      break;
      
    case 'VOL_EXPANSION':
      // Edge from volatility compression about to release
      const volCompression = rawData.volCompression || 1;
      const buildupStress = rawData.stressScore || 0;
      
      // Lower compression = higher edge (max 50)
      score += Math.max(0, 50 - volCompression * 50);
      // Position buildup (max 30)
      score += Math.min(30, buildupStress * 0.3);
      // Range tightness (max 20)
      score += rawData.rangeTightness ? rawData.rangeTightness * 20 : 10;
      break;
      
    case 'TVL_LAG':
      // Edge from TVL growing faster than price
      const tvlDivergence = Math.abs(rawData.divergence || 0);
      const tvlGrowth = rawData.tvlChange7d || 0;
      
      // Divergence strength (max 50)
      score += Math.min(50, tvlDivergence * 3);
      // Absolute TVL growth (max 30)
      score += Math.min(30, tvlGrowth * 2);
      // Sustained pattern (max 20)
      score += rawData.tvlChange30d > rawData.tvlChange7d ? 20 : 10;
      break;
      
    case 'YIELD_SPIKE':
      // Edge from yield spike without price response
      const yieldSpike = rawData.yieldChange || 0;
      const yieldPriceLag = rawData.yieldToPriceDivergence || 0;
      
      // Yield spike magnitude (max 40)
      score += Math.min(40, yieldSpike * 0.4);
      // Yield-price divergence (max 40)
      score += Math.min(40, yieldPriceLag * 2);
      // APY attractiveness (max 20)
      score += rawData.currentApy > 20 ? 20 : rawData.currentApy > 10 ? 15 : rawData.currentApy > 5 ? 10 : 5;
      break;
      
    case 'TVL_INFLOW_LEAD':
      // Edge from TVL leading price historically
      const leadScore = rawData.leadScore || 0;
      const tvlToMcap = rawData.tvlToMcap || 0;
      
      // Lead score (max 50)
      score += Math.min(50, leadScore);
      // TVL/MCap ratio (max 30)
      score += Math.min(30, tvlToMcap * 10);
      // Acceleration (max 20)
      score += rawData.tvlAccelerating ? 20 : 5;
      break;
      
    case 'DEV_ACTIVITY_LEAD':
      // Edge from dev activity without price response
      const devScore = rawData.devScore || 0;
      const commitGrowth = rawData.commitGrowth || 0;
      
      // Dev activity score (max 40)
      score += Math.min(40, devScore * 0.4);
      // Commit growth (max 35)
      score += Math.min(35, commitGrowth * 0.35);
      // Activity accelerating (max 25)
      score += rawData.isAccelerating ? 25 : 10;
      break;
      
    case 'NARRATIVE_LEAD':
      // Edge from attention/ranking rising without price
      const narrativeScore = rawData.narrativeScore || 0;
      const tvlGrowthMonth = rawData.tvlChange1m || 0;
      
      // Narrative score (max 45)
      score += Math.min(45, narrativeScore * 0.45);
      // TVL growth (max 35)
      score += Math.min(35, tvlGrowthMonth);
      // Category leadership (max 20)
      score += (rawData.categoryRank || 100) <= 3 ? 20 : (rawData.categoryRank || 100) <= 10 ? 12 : 5;
      break;
      
    default:
      score = 40; // Default moderate edge
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate Positioning Asymmetry Score (0-100)
 * Measures the risk/reward profile of the trade
 */
function calculatePositioningAsymmetry(signalType, rawData, direction) {
  let score = 50; // Base score
  
  // Calculate implied risk/reward from the data
  const priceChange = rawData.priceChange7d || rawData.priceChange30d || 0;
  const divergence = rawData.divergence || rawData.tvlChange7d - priceChange || 0;
  
  // Asymmetry factors based on signal type
  switch (signalType) {
    case 'FADE_TRADE':
    case 'SQUEEZE_SETUP':
      // High stress = high asymmetry (trapped positions must unwind)
      const stressBonus = (rawData.stressScore || 0) * 0.4;
      score += stressBonus;
      
      // Funding persistence adds to asymmetry
      const persistenceBonus = (rawData.persistence || 0) * 3;
      score += persistenceBonus;
      break;
      
    case 'VOL_EXPANSION':
      // Compressed vol = explosive move potential
      const compressionBonus = rawData.volCompression < 0.5 ? 30 : rawData.volCompression < 0.7 ? 20 : 10;
      score += compressionBonus;
      break;
      
    case 'TVL_LAG':
    case 'TVL_INFLOW_LEAD':
      // Larger divergence = better asymmetry
      score += Math.min(40, Math.abs(divergence) * 2);
      
      // TVL/MCap provides downside cushion
      const tvlCushion = (rawData.tvlToMcap || 0) > 2 ? 15 : (rawData.tvlToMcap || 0) > 1 ? 10 : 5;
      score += tvlCushion;
      break;
      
    case 'YIELD_SPIKE':
      // Yield provides downside protection
      const yieldProtection = Math.min(30, (rawData.currentApy || 0) * 1.5);
      score += yieldProtection;
      
      // Can hedge with perps for even better asymmetry
      score += rawData.hasPerps ? 15 : 0;
      break;
      
    case 'DEV_ACTIVITY_LEAD':
    case 'NARRATIVE_LEAD':
      // Fundamental backing reduces downside risk
      score += (rawData.devScore || rawData.narrativeScore || 0) * 0.3;
      
      // Long time horizon but strong fundamentals
      score += rawData.isAccelerating || rawData.tvlChange1m > 15 ? 20 : 10;
      break;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate Timing Clarity Score (0-100)
 * Measures how clear the entry timing is
 */
function calculateTimingClarity(signalType, rawData, timeHorizon) {
  let score = 50; // Base score
  
  // Shorter time horizons = clearer timing
  const horizonMap = {
    '4-24 hours': 30,
    '12-48 hours': 25,
    '24-72 hours': 20,
    '3-10 days': 15,
    '1-2 weeks': 10,
    '1-3 weeks': 8,
    '2-6 weeks': 5,
    '2-8 weeks': 3,
    '1-3 months': 0
  };
  score += horizonMap[timeHorizon] || 10;
  
  // Signal-specific timing clarity
  switch (signalType) {
    case 'FADE_TRADE':
      // High stress = imminent reversion
      score += (rawData.stressScore || 0) > 70 ? 20 : (rawData.stressScore || 0) > 50 ? 12 : 5;
      break;
      
    case 'SQUEEZE_SETUP':
      // Divergence indicates timing pressure
      score += rawData.fundingDiverged ? 20 : 5;
      break;
      
    case 'VOL_EXPANSION':
      // Extreme compression = imminent breakout
      score += (rawData.volCompression || 1) < 0.5 ? 20 : (rawData.volCompression || 1) < 0.7 ? 12 : 5;
      break;
      
    case 'YIELD_SPIKE':
      // Fresh spike = better timing
      score += (rawData.yieldSpikeAge || 48) < 24 ? 20 : (rawData.yieldSpikeAge || 48) < 48 ? 12 : 5;
      break;
      
    case 'TVL_LAG':
    case 'TVL_INFLOW_LEAD':
      // Accelerating TVL = clearer timing
      score += rawData.tvlAccelerating ? 15 : 5;
      break;
      
    case 'DEV_ACTIVITY_LEAD':
    case 'NARRATIVE_LEAD':
      // These have longer/uncertain timing
      score -= 10;
      score += rawData.isAccelerating ? 10 : 0;
      break;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate Data Confidence Score (0-100)
 * Measures the quality and reliability of underlying data
 */
function calculateDataConfidence(rawData, dataSources = []) {
  let score = 40; // Base score
  
  // More data sources = higher confidence
  const sourceCount = dataSources.length || 1;
  score += Math.min(30, sourceCount * 10);
  
  // Check data completeness
  const dataFields = Object.keys(rawData || {}).length;
  score += Math.min(20, dataFields * 2);
  
  // Penalize if key fields are missing
  if (!rawData.priceChange7d && !rawData.priceChange30d) score -= 10;
  if (!rawData.stressScore && !rawData.devScore && !rawData.narrativeScore) score -= 5;
  
  // Bonus for verified/cross-referenced data
  if (rawData.crossVerified) score += 10;
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate Overall Alpha Quality Score
 * Alpha Score = 0.4×Structural + 0.3×Positioning + 0.2×Timing + 0.1×DataConfidence
 */
function calculateAlphaScore(signalType, rawData, timeHorizon, direction, dataSources = []) {
  const structural = calculateStructuralEdge(signalType, rawData);
  const positioning = calculatePositioningAsymmetry(signalType, rawData, direction);
  const timing = calculateTimingClarity(signalType, rawData, timeHorizon);
  const dataConf = calculateDataConfidence(rawData, dataSources);
  
  const alphaScore = 
    ALPHA_SCORE_WEIGHTS.STRUCTURAL_EDGE * structural +
    ALPHA_SCORE_WEIGHTS.POSITIONING_ASYMMETRY * positioning +
    ALPHA_SCORE_WEIGHTS.TIMING_CLARITY * timing +
    ALPHA_SCORE_WEIGHTS.DATA_CONFIDENCE * dataConf;
  
  return {
    alphaScore: Math.round(alphaScore),
    components: {
      structuralEdge: Math.round(structural),
      positioningAsymmetry: Math.round(positioning),
      timingClarity: Math.round(timing),
      dataConfidence: Math.round(dataConf)
    },
    grade: getAlphaGrade(alphaScore)
  };
}

/**
 * Convert alpha score to grade
 */
function getAlphaGrade(score) {
  if (score >= 80) return 'A';
  if (score >= 70) return 'A-';
  if (score >= 60) return 'B+';
  if (score >= 55) return 'B';
  if (score >= 50) return 'B-';
  if (score >= 45) return 'C+';
  if (score >= 40) return 'C';
  return 'D';
}

/**
 * Standard output schema for signals
 */
function formatSignal({
  signalType,
  tradeType,
  marketContext,
  observedAnomaly,
  whyMatters,
  tradeExpression,
  timeHorizon,
  keyRisks,
  invalidationLevel,
  confidenceScore,
  asset,
  direction = 'LONG',
  positioningAnalysis = {},
  rawData = {},
  dataSources = []
}) {
  // Calculate Alpha Quality Score
  const alphaQuality = calculateAlphaScore(signalType, rawData, timeHorizon, direction, dataSources);
  
  return {
    signalType,
    tradeType,
    asset,
    direction,
    marketContext,
    observedAnomaly,
    whyMatters,
    tradeExpression,
    timeHorizon,
    keyRisks,
    invalidationLevel,
    confidenceScore: Math.min(100, Math.max(0, confidenceScore)),
    // Alpha Quality Scoring
    alphaScore: alphaQuality.alphaScore,
    alphaGrade: alphaQuality.grade,
    alphaComponents: alphaQuality.components,
    positioningAnalysis,
    timestamp: new Date().toISOString(),
    rawData,
    dataSources
  };
}

/**
 * Fetch on-chain metrics from multiple free sources
 * Returns exchange flows, whale activity, and network metrics
 */
async function fetchOnChainMetrics(asset = 'BTC') {
  const metrics = {
    exchangeFlows: null,
    networkActivity: null,
    whaleActivity: null,
    source: []
  };
  
  try {
    // === BLOCKCHAIN.INFO - BTC Exchange Flows (Free) ===
    if (asset === 'BTC') {
      const exchangeUrl = `${APIS.BLOCKCHAIN_INFO}/q/24hrbtcsent?cors=true`;
      const res = await fetchWithTimeout(exchangeUrl, { timeout: 8000 });
      if (res.ok) {
        const btcSent = await res.text();
        metrics.exchangeFlows = {
          btc24hSent: parseFloat(btcSent) / 100000000, // Convert satoshis to BTC
          source: 'blockchain.info'
        };
        metrics.source.push('blockchain.info');
      }
    }
  } catch (e) {
    logger.debug('Blockchain.info fetch failed', { error: e.message });
  }
  
  try {
    // === COINGECKO DEVELOPER DATA - Network Activity ===
    const cgUrl = `${APIS.COINGECKO}/coins/${asset.toLowerCase()}?localization=false&tickers=false&community_data=true&developer_data=true`;
    const cgRes = await fetchWithTimeout(cgUrl, { timeout: 10000 });
    
    if (cgRes.ok) {
      const data = await cgRes.json();
      metrics.networkActivity = {
        devScore: data.developer_score,
        communityScore: data.community_score,
        liquidityScore: data.liquidity_score,
        publicInterestScore: data.public_interest_score,
        sentimentUp: data.sentiment_votes_up_percentage,
        sentimentDown: data.sentiment_votes_down_percentage,
        twitterFollowers: data.community_data?.twitter_followers,
        redditSubscribers: data.community_data?.reddit_subscribers,
        commits4Weeks: data.developer_data?.commit_count_4_weeks,
        codeAdditions4Weeks: data.developer_data?.code_additions_deletions_4_weeks?.additions,
        codeDeletions4Weeks: data.developer_data?.code_additions_deletions_4_weeks?.deletions
      };
      metrics.source.push('coingecko');
    }
  } catch (e) {
    logger.debug('CoinGecko network data fetch failed', { error: e.message });
  }
  
  try {
    // === DEFILLAMA STABLECOINS - Whale/Smart Money Flows ===
    const stableUrl = `${APIS.DEFILLAMA}/stablecoins`;
    const stableRes = await fetchWithTimeout(stableUrl, { timeout: 10000 });
    
    if (stableRes.ok) {
      const data = await stableRes.json();
      const totalMcap = data.peggedAssets?.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0) || 0;
      const change24h = data.peggedAssets?.reduce((sum, s) => {
        const current = s.circulating?.peggedUSD || 0;
        const change = s.circulatingPrevDay?.peggedUSD || current;
        return sum + (current - change);
      }, 0) || 0;
      
      metrics.whaleActivity = {
        stablecoinMcap: totalMcap,
        stablecoinChange24h: change24h,
        stablecoinChangePercent: totalMcap > 0 ? (change24h / totalMcap) * 100 : 0,
        interpretation: change24h > 0 ? 'Stablecoin inflows (bullish signal)' : 'Stablecoin outflows (bearish signal)'
      };
      metrics.source.push('defillama-stablecoins');
    }
  } catch (e) {
    logger.debug('DeFiLlama stablecoins fetch failed', { error: e.message });
  }
  
  return metrics;
}

/**
 * Fetch exchange reserve data (whale accumulation/distribution)
 */
async function fetchExchangeReserves() {
  try {
    // Use DeFiLlama CEX reserves endpoint
    const url = `${APIS.DEFILLAMA}/protocols`;
    const res = await fetchWithTimeout(url, { timeout: 12000 });
    
    if (!res.ok) return null;
    
    const protocols = await res.json();
    
    // Find CEX/Bridge protocols for reserve data
    const exchanges = protocols.filter(p => 
      p.category === 'CEX' || p.category === 'Bridge'
    ).slice(0, 10);
    
    return {
      topExchanges: exchanges.map(e => ({
        name: e.name,
        tvl: e.tvl,
        change1d: e.change_1d,
        change7d: e.change_7d,
        chains: e.chains
      })),
      totalReserves: exchanges.reduce((sum, e) => sum + (e.tvl || 0), 0)
    };
  } catch (e) {
    logger.debug('Exchange reserves fetch failed', { error: e.message });
    return null;
  }
}

/**
 * Fetch gas/fee data for network congestion signals
 */
async function fetchNetworkFees() {
  const fees = {};
  
  try {
    // Ethereum gas from EthGasStation alternative (free)
    const ethUrl = 'https://api.blocknative.com/gasprices/blockprices';
    const ethRes = await fetchWithTimeout(ethUrl, { 
      timeout: 8000,
      headers: { 'Accept': 'application/json' }
    });
    
    if (ethRes.ok) {
      const data = await ethRes.json();
      const blockPrices = data.blockPrices?.[0];
      fees.ethereum = {
        fast: blockPrices?.estimatedPrices?.find(p => p.confidence === 99)?.price,
        standard: blockPrices?.estimatedPrices?.find(p => p.confidence === 90)?.price,
        slow: blockPrices?.estimatedPrices?.find(p => p.confidence === 70)?.price,
        baseFee: blockPrices?.baseFeePerGas
      };
    }
  } catch (e) {
    logger.debug('Ethereum gas fetch failed', { error: e.message });
  }
  
  try {
    // Solana fees from Solana Beach alternative
    const solUrl = 'https://api.mainnet-beta.solana.com';
    const solRes = await fetchWithTimeout(solUrl, {
      method: 'POST',
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getRecentPrioritizationFees',
        params: []
      })
    });
    
    if (solRes.ok) {
      const data = await solRes.json();
      const recentFees = data.result || [];
      const avgFee = recentFees.length > 0
        ? recentFees.reduce((sum, f) => sum + f.prioritizationFee, 0) / recentFees.length
        : 0;
      fees.solana = {
        avgPriorityFee: avgFee,
        recentSlots: recentFees.length
      };
    }
  } catch (e) {
    logger.debug('Solana fees fetch failed', { error: e.message });
  }
  
  return fees;
}

/**
 * Fetch price and market data from CoinGecko
 */
async function fetchMarketData(tokenIds) {
  try {
    const ids = tokenIds.join(',');
    const url = `${APIS.COINGECKO}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d`;
    
    const res = await fetchWithTimeout(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    
    const data = await res.json();
    return data.reduce((acc, coin) => {
      acc[coin.id] = {
        price: coin.current_price,
        marketCap: coin.market_cap,
        volume24h: coin.total_volume,
        priceChange1h: coin.price_change_percentage_1h_in_currency,
        priceChange24h: coin.price_change_percentage_24h_in_currency,
        priceChange7d: coin.price_change_percentage_7d_in_currency,
        priceChange30d: coin.price_change_percentage_30d_in_currency,
        sparkline: coin.sparkline_in_7d?.price || [],
        high24h: coin.high_24h,
        low24h: coin.low_24h,
        ath: coin.ath,
        athChangePercent: coin.ath_change_percentage,
        symbol: coin.symbol.toUpperCase()
      };
      return acc;
    }, {});
  } catch (err) {
    logger.error('Failed to fetch market data', { error: err.message });
    return {};
  }
}

// ============================================================================
// ADVANCED POSITIONING ANALYSIS
// ============================================================================

/**
 * Analyze funding rate persistence and positioning stress
 * Uses price/volume dynamics as proxy for funding when direct API unavailable
 */
function analyzePositioning(priceData) {
  if (!priceData || !priceData.sparkline || priceData.sparkline.length < 24) {
    return null;
  }
  
  const sparkline = priceData.sparkline;
  const volumeRatio = priceData.volume24h / priceData.marketCap;
  
  // Calculate multi-period funding proxy
  // Positive funding = longs paying shorts = bullish bias
  // Negative funding = shorts paying longs = bearish bias
  const periods = splitIntoPeriods(sparkline, 8); // 8 periods of ~21 hours each
  
  const fundingProxy = periods.map((period, idx) => {
    const periodReturn = period.length > 1 
      ? (period[period.length - 1] - period[0]) / period[0]
      : 0;
    const periodVolatility = calculateVolatility(period);
    
    // High volume + positive return = positive funding proxy
    // High volume + negative return = negative funding proxy
    return {
      period: idx + 1,
      return: periodReturn,
      volatility: periodVolatility,
      fundingBias: periodReturn > 0.005 ? 'positive' : periodReturn < -0.005 ? 'negative' : 'neutral'
    };
  });
  
  // Check persistence: how many consecutive periods with same bias
  const positivePeriods = fundingProxy.filter(p => p.fundingBias === 'positive').length;
  const negativePeriods = fundingProxy.filter(p => p.fundingBias === 'negative').length;
  const neutralPeriods = fundingProxy.filter(p => p.fundingBias === 'neutral').length;
  
  // Determine dominant funding bias
  let dominantBias = 'neutral';
  let persistence = 0;
  let fundingStrength = 0;
  
  if (positivePeriods >= SIGNAL_THRESHOLDS.MIN_PERSISTENCE_PERIODS) {
    dominantBias = 'persistent_positive';
    persistence = positivePeriods;
    fundingStrength = positivePeriods / periods.length;
  } else if (negativePeriods >= SIGNAL_THRESHOLDS.MIN_PERSISTENCE_PERIODS) {
    dominantBias = 'persistent_negative';
    persistence = negativePeriods;
    fundingStrength = negativePeriods / periods.length;
  }
  
  // Check price confirmation vs divergence
  const totalReturn = (sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0];
  const priceConfirms = (dominantBias === 'persistent_positive' && totalReturn > 0.02) ||
                        (dominantBias === 'persistent_negative' && totalReturn < -0.02);
  const priceDiverges = (dominantBias === 'persistent_positive' && totalReturn < -0.01) ||
                        (dominantBias === 'persistent_negative' && totalReturn > 0.01);
  
  // Calculate positioning stress score (0-100)
  // Higher = more crowded/stressed positioning
  let stressScore = 0;
  
  // High volume relative to mcap suggests leverage
  if (volumeRatio > SIGNAL_THRESHOLDS.SQUEEZE_LEVERAGE_THRESHOLD) {
    stressScore += 25;
  } else if (volumeRatio > 0.08) {
    stressScore += 15;
  }
  
  // Persistent funding adds stress
  if (persistence >= 5) stressScore += 30;
  else if (persistence >= 3) stressScore += 20;
  
  // Price at extreme positions
  const pricePosition = (priceData.price - priceData.low24h) / (priceData.high24h - priceData.low24h);
  if (pricePosition > 0.9 || pricePosition < 0.1) {
    stressScore += 25;
  } else if (pricePosition > 0.85 || pricePosition < 0.15) {
    stressScore += 15;
  }
  
  // Price divergence from funding suggests stress
  if (priceDiverges) stressScore += 20;
  
  // Determine crowding
  let crowding = 'neutral';
  if (stressScore >= 50) {
    if (dominantBias === 'persistent_positive' || pricePosition > 0.75) {
      crowding = 'crowded_longs';
    } else if (dominantBias === 'persistent_negative' || pricePosition < 0.25) {
      crowding = 'crowded_shorts';
    }
  }
  
  return {
    dominantBias,
    persistence,
    fundingStrength,
    priceConfirms,
    priceDiverges,
    stressScore,
    crowding,
    volumeRatio,
    pricePosition,
    totalReturn7d: totalReturn * 100,
    periodAnalysis: fundingProxy
  };
}

/**
 * Split sparkline into N periods for analysis
 */
function splitIntoPeriods(arr, n) {
  const periods = [];
  const size = Math.floor(arr.length / n);
  for (let i = 0; i < n; i++) {
    const start = i * size;
    const end = i === n - 1 ? arr.length : (i + 1) * size;
    periods.push(arr.slice(start, end));
  }
  return periods;
}

/**
 * Classify trade type based on positioning analysis
 */
function classifyTradeSetup(positioning, volatility) {
  if (!positioning) return null;
  
  const { dominantBias, priceDiverges, stressScore, crowding, pricePosition, volumeRatio } = positioning;
  
  // REJECT: Weak or ambiguous signals
  if (stressScore < 30 && crowding === 'neutral') {
    return { valid: false, reason: 'Insufficient positioning stress' };
  }
  
  if (dominantBias === 'neutral' && Math.abs(positioning.totalReturn7d) < 3) {
    return { valid: false, reason: 'Ambiguous funding with flat price' };
  }
  
  // FADE TRADE: Mean reversion against crowded positioning
  // Conditions: High stress + extreme price position + funding persists
  if (stressScore >= 50 && crowding !== 'neutral') {
    const fadeDirection = crowding === 'crowded_longs' ? 'SHORT' : 'LONG';
    const isFade = (crowding === 'crowded_longs' && pricePosition > 0.75) ||
                   (crowding === 'crowded_shorts' && pricePosition < 0.25);
    
    if (isFade) {
      return {
        valid: true,
        tradeType: 'FADE',
        direction: fadeDirection,
        conviction: stressScore >= 70 ? 'high' : 'medium',
        rationale: `Crowded ${crowding === 'crowded_longs' ? 'long' : 'short'} positioning with price at extreme. Funding costs will pressure overleveraged traders.`
      };
    }
  }
  
  // SQUEEZE SETUP: Liquidation cascade potential
  // Conditions: High leverage (volume ratio) + price diverging from positioning
  if (volumeRatio > SIGNAL_THRESHOLDS.SQUEEZE_LEVERAGE_THRESHOLD && priceDiverges) {
    const squeezeDirection = dominantBias === 'persistent_negative' ? 'LONG' : 'SHORT';
    
    return {
      valid: true,
      tradeType: 'SQUEEZE',
      direction: squeezeDirection,
      conviction: stressScore >= 60 ? 'high' : 'medium',
      rationale: `Price diverging from ${dominantBias.replace('persistent_', '')} funding. High leverage suggests liquidation cascade potential.`
    };
  }
  
  // VOLATILITY EXPANSION: Breakout from compression
  // Conditions: Low volatility + high volume + positioning buildup
  if (volatility < SIGNAL_THRESHOLDS.VOL_COMPRESSION_THRESHOLD && 
      volumeRatio > SIGNAL_THRESHOLDS.MIN_VOLUME_RATIO &&
      positioning.persistence >= 2) {
    
    // Direction based on dominant positioning (breakout direction)
    const breakoutDirection = dominantBias === 'persistent_positive' ? 'LONG' : 
                              dominantBias === 'persistent_negative' ? 'SHORT' : null;
    
    if (breakoutDirection) {
      return {
        valid: true,
        tradeType: 'VOL_EXPANSION',
        direction: breakoutDirection,
        conviction: 'medium',
        rationale: `Volatility compressed to ${(volatility * 100).toFixed(2)}% with position buildup. Breakout imminent in direction of dominant positioning.`
      };
    }
  }
  
  return { valid: false, reason: 'No clear trade setup identified' };
}

/**
 * Fetch TVL data from DeFiLlama
 */
async function fetchTVLData(protocolSlug) {
  try {
    const url = `${APIS.DEFILLAMA}/protocol/${protocolSlug}`;
    const res = await fetchWithTimeout(url, { timeout: 10000 });
    if (!res.ok) return null;
    
    const data = await res.json();
    const tvlHistory = data.tvl || [];
    
    // Calculate TVL changes
    const currentTvl = tvlHistory.length > 0 ? tvlHistory[tvlHistory.length - 1].totalLiquidityUSD : 0;
    const tvl7dAgo = tvlHistory.length >= 8 ? tvlHistory[tvlHistory.length - 8].totalLiquidityUSD : currentTvl;
    const tvl30dAgo = tvlHistory.length >= 31 ? tvlHistory[tvlHistory.length - 31].totalLiquidityUSD : currentTvl;
    
    // Calculate velocity (rate of change)
    const tvlChange7d = tvl7dAgo > 0 ? ((currentTvl - tvl7dAgo) / tvl7dAgo) * 100 : 0;
    const tvlChange30d = tvl30dAgo > 0 ? ((currentTvl - tvl30dAgo) / tvl30dAgo) * 100 : 0;
    
    // Recent 7-day velocity vs prior 7-day velocity (acceleration)
    const tvl14dAgo = tvlHistory.length >= 15 ? tvlHistory[tvlHistory.length - 15].totalLiquidityUSD : tvl7dAgo;
    const priorWeekChange = tvl14dAgo > 0 ? ((tvl7dAgo - tvl14dAgo) / tvl14dAgo) * 100 : 0;
    const tvlAcceleration = tvlChange7d - priorWeekChange;
    
    return {
      currentTvl,
      tvlChange7d,
      tvlChange30d,
      tvlAcceleration,
      tvlHistory: tvlHistory.slice(-30) // Last 30 days
    };
  } catch (err) {
    logger.debug('Failed to fetch TVL', { protocol: protocolSlug, error: err.message });
    return null;
  }
}

/**
 * Fetch yield/APY data from DeFiLlama Yields API
 * Returns pools with their APY history
 */
async function fetchYieldData(protocolName) {
  try {
    // Fetch all pools
    const poolsUrl = `${APIS.DEFILLAMA_YIELDS}/pools`;
    const res = await fetchWithTimeout(poolsUrl, { timeout: 15000 });
    if (!res.ok) throw new Error(`Yields API error: ${res.status}`);
    
    const allPools = await res.json();
    
    // Filter for this protocol's pools
    const protocolPools = allPools.data?.filter(pool => 
      pool.project?.toLowerCase() === protocolName.toLowerCase() &&
      pool.tvlUsd > 1000000 && // Only pools with >$1M TVL
      pool.apy > 0
    ) || [];
    
    if (protocolPools.length === 0) return null;
    
    // Get the top pools by TVL
    const topPools = protocolPools
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, 5);
    
    // For each pool, fetch historical APY data
    const poolsWithHistory = await Promise.all(topPools.map(async (pool) => {
      try {
        const historyUrl = `${APIS.DEFILLAMA_YIELDS}/chart/${pool.pool}`;
        const histRes = await fetchWithTimeout(historyUrl, { timeout: 10000 });
        if (!histRes.ok) return { ...pool, history: [] };
        
        const histData = await histRes.json();
        return {
          ...pool,
          history: histData.data?.slice(-30) || [] // Last 30 days
        };
      } catch {
        return { ...pool, history: [] };
      }
    }));
    
    return poolsWithHistory;
  } catch (err) {
    logger.debug('Failed to fetch yield data', { protocol: protocolName, error: err.message });
    return null;
  }
}

/**
 * Analyze yield dynamics for a protocol
 * Detects: Yield spikes, yield compression, yield-TVL relationships
 */
function analyzeYieldDynamics(pools, priceData) {
  if (!pools || pools.length === 0) return null;
  
  const analysis = {
    hasYieldSpike: false,
    spikeMagnitude: 0,
    avgCurrentApy: 0,
    avgHistoricalApy: 0,
    yieldTrend: 'stable',
    priceResponseToYield: 'none',
    topPool: null,
    spikeDetails: null
  };
  
  // Calculate aggregate metrics across top pools
  let totalCurrentApy = 0;
  let totalHistoricalApy = 0;
  let poolCount = 0;
  let maxSpike = 0;
  let spikePool = null;
  
  for (const pool of pools) {
    if (!pool.history || pool.history.length < 7) continue;
    
    const currentApy = pool.apy;
    const history = pool.history;
    
    // Calculate 7-day average APY
    const recent7dApy = history.slice(-7).reduce((sum, d) => sum + (d.apy || 0), 0) / 7;
    // Calculate 14-30 day average (prior period)
    const priorApy = history.slice(-30, -7).reduce((sum, d) => sum + (d.apy || 0), 0) / Math.max(1, history.slice(-30, -7).length);
    
    totalCurrentApy += currentApy;
    totalHistoricalApy += priorApy;
    poolCount++;
    
    // Detect yield spike: Current APY significantly higher than historical average
    if (priorApy > 0) {
      const apyChange = ((currentApy - priorApy) / priorApy) * 100;
      
      if (apyChange > SIGNAL_THRESHOLDS.MIN_YIELD_SPIKE && currentApy > SIGNAL_THRESHOLDS.MIN_APY_ABSOLUTE) {
        if (apyChange > maxSpike) {
          maxSpike = apyChange;
          spikePool = {
            poolName: pool.symbol || pool.pool,
            chain: pool.chain,
            currentApy,
            priorApy,
            apyChange,
            tvl: pool.tvlUsd,
            poolId: pool.pool
          };
        }
      }
    }
  }
  
  if (poolCount > 0) {
    analysis.avgCurrentApy = totalCurrentApy / poolCount;
    analysis.avgHistoricalApy = totalHistoricalApy / poolCount;
    analysis.topPool = pools[0];
  }
  
  // Determine yield trend
  const yieldChangePercent = analysis.avgHistoricalApy > 0 
    ? ((analysis.avgCurrentApy - analysis.avgHistoricalApy) / analysis.avgHistoricalApy) * 100 
    : 0;
    
  if (yieldChangePercent > 20) analysis.yieldTrend = 'spiking';
  else if (yieldChangePercent > 5) analysis.yieldTrend = 'rising';
  else if (yieldChangePercent < -20) analysis.yieldTrend = 'collapsing';
  else if (yieldChangePercent < -5) analysis.yieldTrend = 'declining';
  
  // Check if price has responded to yield changes
  if (priceData && analysis.yieldTrend === 'spiking') {
    const priceChange7d = priceData.priceChange7d || 0;
    
    if (priceChange7d < 2) {
      analysis.priceResponseToYield = 'lagging'; // Yield up, price flat = opportunity
    } else if (priceChange7d > 5) {
      analysis.priceResponseToYield = 'confirming'; // Already priced in
    } else {
      analysis.priceResponseToYield = 'partial'; // Some response
    }
  }
  
  // Record spike details
  if (maxSpike > SIGNAL_THRESHOLDS.MIN_YIELD_SPIKE) {
    analysis.hasYieldSpike = true;
    analysis.spikeMagnitude = maxSpike;
    analysis.spikeDetails = spikePool;
  }
  
  return analysis;
}

/**
 * Analyze TVL-Price lead/lag relationship
 * Identifies protocols where TVL inflows historically precede price appreciation
 */
function analyzeTVLPriceLeadLag(tvlData, priceData) {
  if (!tvlData?.tvlHistory || tvlData.tvlHistory.length < 14 || !priceData?.sparkline) {
    return null;
  }
  
  const tvlHistory = tvlData.tvlHistory;
  const sparkline = priceData.sparkline;
  
  // Align timeframes: TVL is daily, sparkline is hourly (168 hours = 7 days)
  // Convert sparkline to daily averages for comparison
  const dailyPrices = [];
  const pointsPerDay = Math.floor(sparkline.length / 7);
  
  for (let i = 0; i < 7; i++) {
    const dayStart = i * pointsPerDay;
    const dayEnd = Math.min(dayStart + pointsPerDay, sparkline.length);
    const dayPrices = sparkline.slice(dayStart, dayEnd);
    const avgPrice = dayPrices.reduce((a, b) => a + b, 0) / dayPrices.length;
    dailyPrices.push(avgPrice);
  }
  
  // Calculate correlation between TVL changes and subsequent price changes
  // Look for pattern: TVL up today → price up 2-5 days later
  const tvlRecent7 = tvlHistory.slice(-7);
  
  // Calculate TVL velocity for each day
  const tvlVelocity = [];
  for (let i = 1; i < tvlRecent7.length; i++) {
    const change = tvlRecent7[i-1].totalLiquidityUSD > 0
      ? ((tvlRecent7[i].totalLiquidityUSD - tvlRecent7[i-1].totalLiquidityUSD) / tvlRecent7[i-1].totalLiquidityUSD) * 100
      : 0;
    tvlVelocity.push(change);
  }
  
  // Check for significant recent TVL inflow
  const recentTvlInflow = tvlData.tvlChange7d;
  const isSignificantInflow = recentTvlInflow > SIGNAL_THRESHOLDS.TVL_INFLOW_THRESHOLD;
  
  // Check if price has NOT yet responded
  const priceChange7d = priceData.priceChange7d || 0;
  const priceLagging = priceChange7d < recentTvlInflow * 0.3; // Price moved less than 30% of TVL move
  
  // Analyze TVL acceleration (is inflow accelerating?)
  const tvlAccelerating = tvlData.tvlAcceleration > 3;
  
  // Calculate lead indicator score
  let leadScore = 0;
  if (isSignificantInflow) leadScore += 30;
  if (priceLagging) leadScore += 25;
  if (tvlAccelerating) leadScore += 20;
  if (tvlData.tvlChange30d > tvlData.tvlChange7d * 2) leadScore += 15; // Sustained inflow
  
  // Check TVL-to-MCap ratio (undervaluation indicator)
  const tvlToMcap = tvlData.currentTvl / priceData.marketCap;
  if (tvlToMcap > 3) leadScore += 10; // High TVL relative to market cap
  
  return {
    isSignificantInflow,
    priceLagging,
    tvlAccelerating,
    leadScore,
    tvlChange7d: tvlData.tvlChange7d,
    tvlChange30d: tvlData.tvlChange30d,
    priceChange7d,
    tvlToMcap,
    divergence: recentTvlInflow - priceChange7d,
    pattern: leadScore >= 50 ? 'TVL_LEADING' : leadScore >= 30 ? 'TVL_SLIGHT_LEAD' : 'NO_PATTERN'
  };
}

// ============================================================================
// DEVELOPMENT ACTIVITY & NARRATIVE TRACKING
// ============================================================================

/**
 * Fetch GitHub repository activity data
 * Returns commit activity, contributors, stars, and recent development metrics
 */
async function fetchGitHubActivity(repoPath) {
  if (!repoPath) return null;
  
  try {
    // Fetch repo info (stars, forks, watchers)
    const repoUrl = `${APIS.GITHUB}/repos/${repoPath}`;
    const repoRes = await fetchWithTimeout(repoUrl, { 
      timeout: 10000,
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    
    if (!repoRes.ok) {
      logger.debug('GitHub repo fetch failed', { repo: repoPath, status: repoRes.status });
      return null;
    }
    
    const repoData = await repoRes.json();
    
    // Fetch commit activity (last 52 weeks)
    const commitUrl = `${APIS.GITHUB}/repos/${repoPath}/stats/commit_activity`;
    const commitRes = await fetchWithTimeout(commitUrl, { 
      timeout: 10000,
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    
    let commitActivity = [];
    if (commitRes.ok) {
      commitActivity = await commitRes.json();
    }
    
    // Fetch contributors count
    const contribUrl = `${APIS.GITHUB}/repos/${repoPath}/contributors?per_page=1&anon=true`;
    const contribRes = await fetchWithTimeout(contribUrl, { 
      timeout: 10000,
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    
    let contributorCount = 0;
    if (contribRes.ok) {
      // GitHub returns total count in Link header
      const linkHeader = contribRes.headers.get('Link') || '';
      const match = linkHeader.match(/page=(\d+)>; rel="last"/);
      contributorCount = match ? parseInt(match[1]) : 1;
    }
    
    // Calculate recent activity metrics
    const recentWeeks = commitActivity.slice(-8); // Last 8 weeks
    const priorWeeks = commitActivity.slice(-16, -8); // Prior 8 weeks
    
    const recentCommits = recentWeeks.reduce((sum, w) => sum + (w?.total || 0), 0);
    const priorCommits = priorWeeks.reduce((sum, w) => sum + (w?.total || 0), 0);
    
    const commitGrowth = priorCommits > 0 
      ? ((recentCommits - priorCommits) / priorCommits) * 100 
      : recentCommits > 0 ? 100 : 0;
    
    // Weekly commit trend (last 4 weeks)
    const last4Weeks = commitActivity.slice(-4);
    const weeklyCommits = last4Weeks.map(w => w?.total || 0);
    const avgWeeklyCommits = weeklyCommits.reduce((a, b) => a + b, 0) / 4;
    
    // Check if activity is accelerating
    const isAccelerating = weeklyCommits.length >= 2 && 
      weeklyCommits[weeklyCommits.length - 1] > weeklyCommits[weeklyCommits.length - 2];
    
    return {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      watchers: repoData.subscribers_count || 0,
      openIssues: repoData.open_issues_count || 0,
      contributors: contributorCount,
      recentCommits,
      priorCommits,
      commitGrowth,
      avgWeeklyCommits,
      weeklyCommits,
      isAccelerating,
      lastPush: repoData.pushed_at,
      language: repoData.language,
      repoAge: Math.floor((Date.now() - new Date(repoData.created_at).getTime()) / (1000 * 60 * 60 * 24))
    };
  } catch (err) {
    logger.debug('GitHub activity fetch failed', { repo: repoPath, error: err.message });
    return null;
  }
}

/**
 * Fetch protocol rankings from DeFiLlama
 * Returns current rank and historical ranking data
 */
async function fetchProtocolRanking(protocolSlug) {
  try {
    // Fetch all protocols to get rankings
    const url = `${APIS.DEFILLAMA}/protocols`;
    const res = await fetchWithTimeout(url, { timeout: 15000 });
    if (!res.ok) return null;
    
    const protocols = await res.json();
    
    // Sort by TVL to get rankings
    const sortedByTvl = protocols
      .filter(p => p.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl);
    
    const currentRank = sortedByTvl.findIndex(p => p.slug === protocolSlug) + 1;
    if (currentRank === 0) return null;
    
    const protocol = sortedByTvl.find(p => p.slug === protocolSlug);
    
    // Get category ranking
    const categoryProtocols = sortedByTvl.filter(p => p.category === protocol?.category);
    const categoryRank = categoryProtocols.findIndex(p => p.slug === protocolSlug) + 1;
    
    // Calculate chain distribution
    const chains = protocol?.chains || [];
    const chainCount = chains.length;
    
    return {
      currentRank,
      categoryRank,
      category: protocol?.category,
      tvl: protocol?.tvl,
      tvlChange1d: protocol?.change_1d,
      tvlChange7d: protocol?.change_7d,
      tvlChange1m: protocol?.change_1m,
      chainCount,
      chains,
      mcap: protocol?.mcap,
      totalProtocols: sortedByTvl.length
    };
  } catch (err) {
    logger.debug('Protocol ranking fetch failed', { protocol: protocolSlug, error: err.message });
    return null;
  }
}

/**
 * Analyze development activity vs price relationship
 * Identifies protocols with high dev activity but lagging price
 */
function analyzeDevActivityMismatch(githubData, priceData, tvlData) {
  if (!githubData || !priceData) return null;
  
  const analysis = {
    hasDevLead: false,
    devScore: 0,
    priceLagging: false,
    liquidityLagging: false,
    mismatchType: null,
    confidence: 0
  };
  
  // Calculate development score (0-100)
  let devScore = 0;
  
  // Commit activity growth
  if (githubData.commitGrowth > 100) devScore += 30;
  else if (githubData.commitGrowth > 50) devScore += 20;
  else if (githubData.commitGrowth > 20) devScore += 10;
  
  // Recent commit velocity
  if (githubData.avgWeeklyCommits > 50) devScore += 20;
  else if (githubData.avgWeeklyCommits > 20) devScore += 12;
  else if (githubData.avgWeeklyCommits > 10) devScore += 6;
  
  // Activity acceleration
  if (githubData.isAccelerating) devScore += 15;
  
  // Contributor base
  if (githubData.contributors > 50) devScore += 15;
  else if (githubData.contributors > 20) devScore += 10;
  else if (githubData.contributors > 10) devScore += 5;
  
  // Community interest (stars)
  if (githubData.stars > 5000) devScore += 10;
  else if (githubData.stars > 1000) devScore += 6;
  else if (githubData.stars > 500) devScore += 3;
  
  // Recency bonus
  const daysSinceLastPush = (Date.now() - new Date(githubData.lastPush).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastPush < 7) devScore += 10;
  else if (daysSinceLastPush < 14) devScore += 5;
  
  analysis.devScore = Math.min(100, devScore);
  
  // Check if price is lagging dev activity
  const priceChange30d = priceData.priceChange30d || 0;
  const priceChange7d = priceData.priceChange7d || 0;
  
  // Dev activity is high but price flat/down
  if (analysis.devScore >= 50 && priceChange30d < SIGNAL_THRESHOLDS.DEV_PRICE_LAG_THRESHOLD) {
    analysis.priceLagging = true;
  }
  
  // Check liquidity/TVL lag
  if (tvlData) {
    const tvlGrowth = tvlData.tvlChange30d || 0;
    // Strong dev activity but TVL not following
    if (analysis.devScore >= 50 && tvlGrowth < 5) {
      analysis.liquidityLagging = true;
    }
  }
  
  // Determine mismatch type
  if (analysis.priceLagging && analysis.liquidityLagging) {
    analysis.mismatchType = 'FULL_DISCONNECT';
    analysis.hasDevLead = true;
  } else if (analysis.priceLagging) {
    analysis.mismatchType = 'PRICE_LAG';
    analysis.hasDevLead = true;
  } else if (analysis.liquidityLagging) {
    analysis.mismatchType = 'LIQUIDITY_LAG';
    analysis.hasDevLead = analysis.devScore >= 60;
  }
  
  // Calculate confidence based on data quality and signal strength
  if (analysis.hasDevLead) {
    analysis.confidence = Math.min(75, 30 + (analysis.devScore / 2));
    if (analysis.mismatchType === 'FULL_DISCONNECT') analysis.confidence += 10;
    if (githubData.commitGrowth > 50) analysis.confidence += 8;
  }
  
  return analysis;
}

/**
 * Analyze narrative/attention indicators
 * Tracks ranking improvements, ecosystem growth, and attention metrics
 */
function analyzeNarrativeMismatch(rankingData, priceData, tvlData) {
  if (!rankingData || !priceData) return null;
  
  const analysis = {
    hasNarrativeLead: false,
    narrativeScore: 0,
    priceLagging: false,
    mismatchType: null,
    rankingImprovement: 0,
    ecosystemGrowth: 0,
    failureScenarios: []
  };
  
  // Calculate narrative/attention score
  let narrativeScore = 0;
  
  // TVL growth indicates protocol attention
  const tvlChange7d = rankingData.tvlChange7d || 0;
  const tvlChange1m = rankingData.tvlChange1m || 0;
  
  if (tvlChange7d > 20) narrativeScore += 25;
  else if (tvlChange7d > 10) narrativeScore += 15;
  else if (tvlChange7d > 5) narrativeScore += 8;
  
  // Sustained growth (monthly)
  if (tvlChange1m > 30) narrativeScore += 20;
  else if (tvlChange1m > 15) narrativeScore += 12;
  
  // Multi-chain expansion indicates ecosystem growth
  if (rankingData.chainCount >= 5) narrativeScore += 15;
  else if (rankingData.chainCount >= 3) narrativeScore += 10;
  
  // Ranking in top tier
  if (rankingData.currentRank <= 20) narrativeScore += 15;
  else if (rankingData.currentRank <= 50) narrativeScore += 10;
  else if (rankingData.currentRank <= 100) narrativeScore += 5;
  
  // Category leader bonus
  if (rankingData.categoryRank <= 3) narrativeScore += 15;
  else if (rankingData.categoryRank <= 10) narrativeScore += 8;
  
  analysis.narrativeScore = Math.min(100, narrativeScore);
  analysis.ecosystemGrowth = tvlChange1m;
  
  // Check if price is lagging narrative/fundamentals
  const priceChange7d = priceData.priceChange7d || 0;
  const priceChange30d = priceData.priceChange30d || 0;
  
  // Strong narrative metrics but price flat
  if (analysis.narrativeScore >= 45) {
    if (tvlChange7d > 10 && priceChange7d < 3) {
      analysis.priceLagging = true;
      analysis.mismatchType = 'TVL_ATTENTION_LEADS';
    }
    
    if (tvlChange1m > 20 && priceChange30d < 8) {
      analysis.priceLagging = true;
      analysis.mismatchType = 'SUSTAINED_ATTENTION_LEADS';
    }
  }
  
  // Estimate ranking improvement (would need historical data for accuracy)
  // Using TVL growth as proxy
  if (tvlChange1m > 25) {
    analysis.rankingImprovement = Math.ceil(tvlChange1m / 5);
  }
  
  // Define failure scenarios
  if (analysis.priceLagging) {
    analysis.hasNarrativeLead = true;
    
    analysis.failureScenarios = [
      {
        scenario: 'TVL is mercenary/incentivized',
        trigger: 'Incentive program ends or yields drop',
        impact: 'TVL exits rapidly, price dumps',
        likelihood: tvlChange1m > 50 ? 'HIGH' : 'MEDIUM'
      },
      {
        scenario: 'Market-wide correction',
        trigger: 'BTC drops >15%, risk-off sentiment',
        impact: 'All alts sell off, fundamentals ignored',
        likelihood: 'MEDIUM'
      },
      {
        scenario: 'Competitive threat',
        trigger: 'New protocol captures market share',
        impact: 'TVL/users migrate, narrative shifts',
        likelihood: rankingData.categoryRank > 3 ? 'MEDIUM' : 'LOW'
      },
      {
        scenario: 'Token unlock/inflation',
        trigger: 'Large token unlock event',
        impact: 'Supply shock overwhelms demand',
        likelihood: 'UNKNOWN'
      }
    ];
  }
  
  return analysis;
}

// ============================================================================
// SCAN FUNCTIONS - Detect & Classify Signals
// ============================================================================

/**
 * SCAN: Development Activity Lead
 * Identifies protocols with high GitHub activity but lagging price/liquidity
 */
async function scanDevActivityLead() {
  logger.info('Scanning for dev activity leading price...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_PROTOCOLS.map(p => p.token);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const protocol of SCAN_PROTOCOLS) {
      if (!protocol.github) continue;
      
      const [githubData, tvlData, priceData] = await Promise.all([
        fetchGitHubActivity(protocol.github),
        fetchTVLData(protocol.slug),
        Promise.resolve(marketData[protocol.token])
      ]);
      
      if (!githubData || !priceData) continue;
      
      const devAnalysis = analyzeDevActivityMismatch(githubData, priceData, tvlData);
      if (!devAnalysis || !devAnalysis.hasDevLead) continue;
      
      const priceChange30d = priceData.priceChange30d || 0;
      const priceChange7d = priceData.priceChange7d || 0;
      
      // Define positioning strategy
      let positioningStrategy, timeHorizon, entryApproach;
      
      if (devAnalysis.mismatchType === 'FULL_DISCONNECT') {
        positioningStrategy = `Accumulation Strategy: Build position in ${priceData.symbol} over 2-4 weeks using DCA. High dev activity (${githubData.commitGrowth.toFixed(0)}% commit growth) with zero price response suggests market sleeping on fundamentals.`;
        timeHorizon = '4-8 weeks';
        entryApproach = 'DCA 25% weekly over 4 weeks';
      } else if (devAnalysis.mismatchType === 'PRICE_LAG') {
        positioningStrategy = `Directional Long: ${priceData.symbol} shows ${githubData.avgWeeklyCommits.toFixed(0)} commits/week (+${githubData.commitGrowth.toFixed(0)}% growth) but price flat. Enter 50% now, 50% on any dip >5%.`;
        timeHorizon = '2-6 weeks';
        entryApproach = 'Scale in on weakness';
      } else {
        positioningStrategy = `Monitor & Accumulate: Dev activity strong but early. Small starter position, add if TVL follows development.`;
        timeHorizon = '1-3 months';
        entryApproach = 'Small initial position';
      }
      
      // Define failure scenarios
      const failureScenarios = [
        `Dev activity is maintenance, not feature development → Check commit messages for substance`,
        `Contributors are bots/low-quality → Verify contributor profiles`,
        `Market knows something negative → Check social sentiment, audits`,
        `Token has poor tokenomics/high inflation → Verify emission schedule`,
        `Broader market downturn overwhelms fundamentals`
      ];
      
      const confidence = calculateDevLeadConfidence(devAnalysis, githubData, priceData);
      if (confidence < SIGNAL_THRESHOLDS.MIN_CONFIDENCE) continue;
      
      const signal = formatSignal({
        signalType: 'DEV_ACTIVITY_LEAD',
        tradeType: 'ACCUMULATION',
        asset: `${protocol.name} (${priceData.symbol})`,
        direction: 'LONG',
        conviction: confidence >= 65 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
        marketContext: `${protocol.name} GitHub: ${githubData.recentCommits} commits (8wk), +${githubData.commitGrowth.toFixed(0)}% vs prior period. ${githubData.contributors} contributors, ${githubData.stars} stars. Token price 30d: ${priceChange30d > 0 ? '+' : ''}${priceChange30d.toFixed(1)}%.`,
        observedAnomaly: `Development activity surging (+${githubData.commitGrowth.toFixed(0)}% commit growth, ${githubData.isAccelerating ? 'ACCELERATING' : 'steady'}) but price only moved ${priceChange30d.toFixed(1)}% in 30d. Dev score: ${devAnalysis.devScore}/100. Mismatch type: ${devAnalysis.mismatchType}.`,
        whyMatters: `High development activity typically precedes product launches, upgrades, or partnerships. Market is slow to price in dev fundamentals - 60-80% of altcoin rallies correlate with prior dev activity spikes. Current disconnect suggests asymmetric opportunity.`,
        tradeExpression: positioningStrategy,
        alternativeTrade: `Hedge approach: Long ${priceData.symbol} + short BTC to isolate alpha from market beta.`,
        timeHorizon,
        keyRisks: failureScenarios.join(' | '),
        invalidationLevel: `Commit activity drops >50%, or price falls >20% without recovery, or major negative news`,
        confidenceScore: confidence,
        failureScenarios,
        rawData: {
          commits8wk: githubData.recentCommits,
          commitGrowth: githubData.commitGrowth,
          contributors: githubData.contributors,
          stars: githubData.stars,
          avgWeeklyCommits: githubData.avgWeeklyCommits,
          devScore: devAnalysis.devScore,
          priceChange30d,
          mismatchType: devAnalysis.mismatchType,
          isAccelerating: githubData.isAccelerating
        },
        dataSources: ['GitHub API', 'CoinGecko']
      });
      
      signals.push(signal);
    }
  } catch (err) {
    logger.error('Dev activity lead scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * SCAN: Narrative/Ranking Lead
 * Identifies protocols where attention/rankings are rising but price lags
 */
async function scanNarrativeLead() {
  logger.info('Scanning for narrative/ranking leading price...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_PROTOCOLS.map(p => p.token);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const protocol of SCAN_PROTOCOLS) {
      const [rankingData, tvlData, priceData] = await Promise.all([
        fetchProtocolRanking(protocol.slug),
        fetchTVLData(protocol.slug),
        Promise.resolve(marketData[protocol.token])
      ]);
      
      if (!rankingData || !priceData) continue;
      
      const narrativeAnalysis = analyzeNarrativeMismatch(rankingData, priceData, tvlData);
      if (!narrativeAnalysis || !narrativeAnalysis.hasNarrativeLead) continue;
      
      const priceChange7d = priceData.priceChange7d || 0;
      const priceChange30d = priceData.priceChange30d || 0;
      
      // Define positioning strategy based on mismatch type
      let positioningStrategy, timeHorizon;
      
      if (narrativeAnalysis.mismatchType === 'SUSTAINED_ATTENTION_LEADS') {
        positioningStrategy = `Conviction Long: ${priceData.symbol} has ${rankingData.tvlChange1m.toFixed(0)}% monthly TVL growth, rank #${rankingData.currentRank} overall (#${rankingData.categoryRank} in ${rankingData.category}). Price hasn't kept pace. Full position with trailing stop.`;
        timeHorizon = '2-8 weeks';
      } else {
        positioningStrategy = `Tactical Long: ${priceData.symbol} showing early narrative momentum (${rankingData.tvlChange7d.toFixed(0)}% 7d TVL). Entry 60% now, 40% on confirmation of sustained inflows.`;
        timeHorizon = '1-4 weeks';
      }
      
      // Format failure scenarios
      const failureScenariosText = narrativeAnalysis.failureScenarios
        .filter(f => f.likelihood !== 'LOW')
        .map(f => `${f.scenario} (${f.likelihood}): ${f.trigger} → ${f.impact}`)
        .join(' | ');
      
      const confidence = calculateNarrativeLeadConfidence(narrativeAnalysis, rankingData, priceData);
      if (confidence < SIGNAL_THRESHOLDS.MIN_CONFIDENCE) continue;
      
      const signal = formatSignal({
        signalType: 'NARRATIVE_LEAD',
        tradeType: 'NARRATIVE_MOMENTUM',
        asset: `${protocol.name} (${priceData.symbol})`,
        direction: 'LONG',
        conviction: confidence >= 65 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
        marketContext: `${protocol.name} rank #${rankingData.currentRank} by TVL ($${formatNumber(rankingData.tvl)}). Category: ${rankingData.category} (#${rankingData.categoryRank}). TVL 7d: ${rankingData.tvlChange7d > 0 ? '+' : ''}${rankingData.tvlChange7d.toFixed(1)}% | 30d: ${rankingData.tvlChange1m > 0 ? '+' : ''}${rankingData.tvlChange1m.toFixed(1)}%. Active on ${rankingData.chainCount} chains.`,
        observedAnomaly: `Protocol attention rising (TVL +${rankingData.tvlChange1m.toFixed(0)}% monthly, narrative score ${narrativeAnalysis.narrativeScore}/100) but token price only +${priceChange30d.toFixed(1)}% in 30d. ${narrativeAnalysis.mismatchType === 'SUSTAINED_ATTENTION_LEADS' ? 'SUSTAINED pattern detected.' : 'Early signal.'}`,
        whyMatters: `TVL inflows and ranking improvements are leading indicators. Smart money/LPs entering before retail. Price typically catches up within 2-6 weeks as narrative spreads. Current divergence suggests early positioning opportunity.`,
        tradeExpression: positioningStrategy,
        alternativeTrade: protocol.hasYield ? `Yield + Momentum: Deposit into ${protocol.name} pools to earn yield while waiting for price catch-up.` : null,
        timeHorizon,
        keyRisks: failureScenariosText || 'Standard DeFi risks: Smart contract, market downturn, competitive threats',
        invalidationLevel: `TVL drops >15%, ranking falls >10 positions, or price drops >15% without TVL decline`,
        confidenceScore: confidence,
        failureScenarios: narrativeAnalysis.failureScenarios,
        rawData: {
          currentRank: rankingData.currentRank,
          categoryRank: rankingData.categoryRank,
          category: rankingData.category,
          tvl: rankingData.tvl,
          tvlChange7d: rankingData.tvlChange7d,
          tvlChange1m: rankingData.tvlChange1m,
          chainCount: rankingData.chainCount,
          narrativeScore: narrativeAnalysis.narrativeScore,
          priceChange30d,
          mismatchType: narrativeAnalysis.mismatchType
        },
        dataSources: ['DeFiLlama', 'CoinGecko']
      });
      
      signals.push(signal);
    }
  } catch (err) {
    logger.error('Narrative lead scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * Calculate confidence for dev activity lead signals
 */
function calculateDevLeadConfidence(devAnalysis, githubData, priceData) {
  let score = 30; // Base score
  
  // Dev score contribution
  if (devAnalysis.devScore >= 70) score += 20;
  else if (devAnalysis.devScore >= 50) score += 12;
  else if (devAnalysis.devScore >= 35) score += 6;
  
  // Mismatch severity
  if (devAnalysis.mismatchType === 'FULL_DISCONNECT') score += 15;
  else if (devAnalysis.mismatchType === 'PRICE_LAG') score += 10;
  else score += 5;
  
  // Activity acceleration
  if (githubData.isAccelerating) score += 8;
  
  // High commit growth
  if (githubData.commitGrowth > 100) score += 10;
  else if (githubData.commitGrowth > 50) score += 6;
  
  // Contributor base (more contributors = more legitimate)
  if (githubData.contributors > 30) score += 8;
  else if (githubData.contributors > 15) score += 4;
  
  // Price really hasn't moved
  const priceMove = Math.abs(priceData.priceChange30d || 0);
  if (priceMove < 3) score += 10;
  else if (priceMove < 8) score += 5;
  
  // Discount for uncertainty
  score -= 12; // Dev activity doesn't always translate to price
  
  return Math.min(80, score);
}

/**
 * Calculate confidence for narrative lead signals
 */
function calculateNarrativeLeadConfidence(narrativeAnalysis, rankingData, priceData) {
  let score = 30; // Base score
  
  // Narrative score contribution
  if (narrativeAnalysis.narrativeScore >= 70) score += 18;
  else if (narrativeAnalysis.narrativeScore >= 50) score += 12;
  else if (narrativeAnalysis.narrativeScore >= 35) score += 6;
  
  // TVL growth strength
  const tvlGrowth = rankingData.tvlChange1m || 0;
  if (tvlGrowth > 30) score += 15;
  else if (tvlGrowth > 15) score += 10;
  else if (tvlGrowth > 8) score += 5;
  
  // Ranking quality
  if (rankingData.currentRank <= 30) score += 10;
  else if (rankingData.currentRank <= 60) score += 6;
  
  if (rankingData.categoryRank <= 5) score += 8;
  
  // Sustained vs early
  if (narrativeAnalysis.mismatchType === 'SUSTAINED_ATTENTION_LEADS') score += 10;
  
  // Price divergence (larger = clearer signal)
  const priceMove = priceData.priceChange30d || 0;
  const divergence = tvlGrowth - priceMove;
  if (divergence > 20) score += 10;
  else if (divergence > 10) score += 6;
  
  // Multi-chain presence (more chains = more adoption)
  if (rankingData.chainCount >= 4) score += 5;
  
  // Discount for mercenary capital risk
  score -= 10;
  
  return Math.min(80, score);
}

/**
 * SCAN: Yield Spike without Price Response
 * Identifies protocols where APY has spiked but token price hasn't reacted
 */
async function scanYieldSpikes() {
  logger.info('Scanning for yield spikes without price response...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_PROTOCOLS.filter(p => p.hasYield).map(p => p.token);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const protocol of SCAN_PROTOCOLS.filter(p => p.hasYield)) {
      const yieldData = await fetchYieldData(protocol.name);
      const priceData = marketData[protocol.token];
      
      if (!yieldData || !priceData) continue;
      
      const yieldAnalysis = analyzeYieldDynamics(yieldData, priceData);
      if (!yieldAnalysis) continue;
      
      // SIGNAL: Yield spike with lagging price
      if (yieldAnalysis.hasYieldSpike && yieldAnalysis.priceResponseToYield === 'lagging') {
        const spike = yieldAnalysis.spikeDetails;
        const priceChange7d = priceData.priceChange7d || 0;
        
        // Calculate why market hasn't priced this in
        const notPricedInReasons = [];
        if (Math.abs(priceChange7d) < 3) notPricedInReasons.push('Token price essentially flat despite yield spike');
        if (spike.apyChange > 50) notPricedInReasons.push('Yield change too recent (<72h) for market to fully digest');
        if (priceData.volume24h / priceData.marketCap < 0.05) notPricedInReasons.push('Low trading volume = slow price discovery');
        
        // Formulate trade strategies
        const directionalTrade = `Long ${priceData.symbol} spot. Entry: $${formatNumber(priceData.price)}. Target: +${Math.min(spike.apyChange * 0.3, 15).toFixed(1)}% as market prices in elevated yield. Stop: -8%.`;
        
        const yieldHedgeTrade = `Yield Capture + Hedge: Deposit into ${spike.poolName} pool (${spike.currentApy.toFixed(1)}% APY). Hedge token exposure by shorting ${priceData.symbol} perps (delta-neutral). Net yield: ~${(spike.currentApy * 0.7).toFixed(1)}% after funding costs.`;
        
        const confidence = calculateYieldSpikeConfidence(yieldAnalysis, priceData);
        
        // REJECT if confidence too low
        if (confidence < SIGNAL_THRESHOLDS.MIN_CONFIDENCE) continue;
        
        const signal = formatSignal({
          signalType: 'YIELD_SPIKE',
          tradeType: 'YIELD_OPPORTUNITY',
          asset: `${protocol.name} (${priceData.symbol})`,
          direction: 'LONG',
          conviction: confidence >= 65 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
          marketContext: `${protocol.name} yield spiked +${spike.apyChange.toFixed(0)}% to ${spike.currentApy.toFixed(1)}% APY. Pool: ${spike.poolName} on ${spike.chain}. Pool TVL: $${formatNumber(spike.tvl)}. Token price 7d: ${priceChange7d > 0 ? '+' : ''}${priceChange7d.toFixed(1)}%.`,
          observedAnomaly: `Yield spike detected: APY jumped from ${spike.priorApy.toFixed(1)}% to ${spike.currentApy.toFixed(1)}% (+${spike.apyChange.toFixed(0)}%) but token price only moved ${priceChange7d.toFixed(1)}%. This is a ${(spike.apyChange / Math.max(1, Math.abs(priceChange7d))).toFixed(1)}x yield-to-price divergence.`,
          whyMatters: `Elevated yields attract capital → increased protocol revenue → token value. ${notPricedInReasons.join('. ')}. Historically, yield spikes >25% lead to token appreciation within 1-2 weeks as yield farmers rotate in.`,
          tradeExpression: directionalTrade,
          alternativeTrade: yieldHedgeTrade,
          timeHorizon: '3-10 days',
          keyRisks: 'Yield could normalize quickly (emissions reduction), smart contract risk, impermanent loss (for LP pools), broader market selloff',
          invalidationLevel: `APY drops below ${(spike.priorApy * 1.1).toFixed(1)}% or token price drops >12%`,
          confidenceScore: confidence,
          rawData: {
            currentApy: spike.currentApy,
            priorApy: spike.priorApy,
            apyChange: spike.apyChange,
            poolTvl: spike.tvl,
            priceChange7d,
            yieldTrend: yieldAnalysis.yieldTrend,
            yieldChange: spike.apyChange,
            yieldToPriceDivergence: spike.apyChange / Math.max(1, Math.abs(priceChange7d))
          },
          dataSources: ['DeFiLlama Yields', 'CoinGecko']
        });
        
        signals.push(signal);
      }
    }
  } catch (err) {
    logger.error('Yield spike scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * SCAN: TVL Inflows that historically precede token appreciation
 * Identifies protocols with significant capital inflows where price hasn't caught up
 */
async function scanTVLInflowLead() {
  logger.info('Scanning for TVL inflow leading price patterns...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_PROTOCOLS.map(p => p.token);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const protocol of SCAN_PROTOCOLS) {
      const tvlData = await fetchTVLData(protocol.slug);
      const priceData = marketData[protocol.token];
      
      if (!tvlData || !priceData) continue;
      
      // Analyze TVL-price lead/lag relationship
      const leadLagAnalysis = analyzeTVLPriceLeadLag(tvlData, priceData);
      if (!leadLagAnalysis || leadLagAnalysis.pattern === 'NO_PATTERN') continue;
      
      // Only signal if TVL is clearly leading
      if (leadLagAnalysis.leadScore < 45) continue;
      
      // Calculate why market hasn't priced this in
      const notPricedInReasons = [];
      if (leadLagAnalysis.priceLagging) {
        notPricedInReasons.push(`Price (+${leadLagAnalysis.priceChange7d.toFixed(1)}%) lagging TVL inflow (+${leadLagAnalysis.tvlChange7d.toFixed(1)}%)`);
      }
      if (leadLagAnalysis.tvlAccelerating) {
        notPricedInReasons.push('TVL inflows accelerating - market may not have recognized the trend');
      }
      if (leadLagAnalysis.tvlToMcap > 2) {
        notPricedInReasons.push(`High TVL/MCap ratio (${leadLagAnalysis.tvlToMcap.toFixed(1)}x) suggests undervaluation`);
      }
      if (priceData.volume24h / priceData.marketCap < 0.06) {
        notPricedInReasons.push('Low trading activity = slow price adjustment');
      }
      
      // Formulate trade strategies
      const expectedCatchup = Math.min(leadLagAnalysis.divergence * 0.5, 20);
      const directionalTrade = `Long ${priceData.symbol} spot. TVL leading price by ${leadLagAnalysis.divergence.toFixed(1)}%. Target: +${expectedCatchup.toFixed(1)}% catch-up move over 1-2 weeks.`;
      
      // For yield-bearing protocols, add yield capture strategy
      let yieldHedgeTrade = null;
      if (protocol.hasYield) {
        yieldHedgeTrade = `Yield + Appreciation: Deposit assets into ${protocol.name} (earn yield while gaining token exposure). Or: Long token + short perps to capture TVL-driven appreciation while earning funding.`;
      }
      
      const confidence = calculateTVLLeadConfidence(leadLagAnalysis, tvlData, priceData);
      
      // REJECT if confidence too low
      if (confidence < SIGNAL_THRESHOLDS.MIN_CONFIDENCE) continue;
      
      const signal = formatSignal({
        signalType: 'TVL_INFLOW_LEAD',
        tradeType: 'FUNDAMENTAL_LEAD',
        asset: `${protocol.name} (${priceData.symbol})`,
        direction: 'LONG',
        conviction: confidence >= 65 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
        marketContext: `${protocol.name} TVL: $${formatNumber(tvlData.currentTvl)}. 7d TVL: +${leadLagAnalysis.tvlChange7d.toFixed(1)}% | 30d TVL: +${leadLagAnalysis.tvlChange30d.toFixed(1)}%. Token 7d: ${leadLagAnalysis.priceChange7d > 0 ? '+' : ''}${leadLagAnalysis.priceChange7d.toFixed(1)}%. TVL/MCap: ${leadLagAnalysis.tvlToMcap.toFixed(2)}x.`,
        observedAnomaly: `TVL inflows (+${leadLagAnalysis.tvlChange7d.toFixed(1)}%) significantly outpacing token price (+${leadLagAnalysis.priceChange7d.toFixed(1)}%). Divergence: ${leadLagAnalysis.divergence.toFixed(1)}%. ${leadLagAnalysis.tvlAccelerating ? 'TVL growth is ACCELERATING.' : 'TVL growth is sustained.'}`,
        whyMatters: `Historically, sustained TVL inflows precede token appreciation by 1-3 weeks. Capital flows into protocol → increased revenue/fees → token accrual → price catch-up. ${notPricedInReasons.join('. ')}.`,
        tradeExpression: directionalTrade,
        alternativeTrade: yieldHedgeTrade,
        timeHorizon: '1-3 weeks',
        keyRisks: 'Mercenary capital (incentivized TVL that will leave), token inflation diluting gains, smart contract exploit, broader market correction',
        invalidationLevel: `TVL drops >15% from current or price falls below $${formatNumber(priceData.price * 0.88)}`,
        confidenceScore: confidence,
        rawData: {
          tvl: tvlData.currentTvl,
          tvlChange7d: leadLagAnalysis.tvlChange7d,
          tvlChange30d: leadLagAnalysis.tvlChange30d,
          priceChange7d: leadLagAnalysis.priceChange7d,
          divergence: leadLagAnalysis.divergence,
          tvlToMcap: leadLagAnalysis.tvlToMcap,
          leadScore: leadLagAnalysis.leadScore,
          tvlAccelerating: leadLagAnalysis.tvlAccelerating
        },
        dataSources: ['DeFiLlama', 'CoinGecko']
      });
      
      signals.push(signal);
    }
  } catch (err) {
    logger.error('TVL inflow lead scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * Calculate confidence for yield spike signals
 */
function calculateYieldSpikeConfidence(yieldAnalysis, priceData) {
  let score = 35; // Base score
  
  const spike = yieldAnalysis.spikeDetails;
  if (!spike) return 0;
  
  // Larger yield spike = more confidence
  if (spike.apyChange > 100) score += 20;
  else if (spike.apyChange > 50) score += 15;
  else if (spike.apyChange > 25) score += 8;
  
  // Higher absolute APY = more attractive
  if (spike.currentApy > 20) score += 12;
  else if (spike.currentApy > 10) score += 8;
  else if (spike.currentApy > 5) score += 4;
  
  // Price hasn't moved = clearer opportunity
  const priceMove = Math.abs(priceData.priceChange7d || 0);
  if (priceMove < 2) score += 15;
  else if (priceMove < 5) score += 8;
  
  // Pool TVL health
  if (spike.tvl > 100e6) score += 10; // >$100M TVL
  else if (spike.tvl > 10e6) score += 5;
  
  // Discount for uncertainty
  score -= 10; // Yield sustainability uncertain
  
  return Math.min(80, score);
}

/**
 * Calculate confidence for TVL inflow lead signals
 */
function calculateTVLLeadConfidence(leadLagAnalysis, tvlData, priceData) {
  let score = 30; // Base score
  
  // Higher lead score = more confidence
  if (leadLagAnalysis.leadScore >= 70) score += 25;
  else if (leadLagAnalysis.leadScore >= 50) score += 15;
  else if (leadLagAnalysis.leadScore >= 30) score += 8;
  
  // Larger divergence = stronger signal
  if (leadLagAnalysis.divergence > 20) score += 15;
  else if (leadLagAnalysis.divergence > 10) score += 10;
  else if (leadLagAnalysis.divergence > 5) score += 5;
  
  // TVL acceleration adds confidence
  if (leadLagAnalysis.tvlAccelerating) score += 12;
  
  // Sustained inflow (30d > 7d extrapolated)
  if (tvlData.tvlChange30d > tvlData.tvlChange7d * 3) score += 10;
  
  // Higher TVL = more reliable
  if (tvlData.currentTvl > 1e9) score += 8;
  else if (tvlData.currentTvl > 100e6) score += 4;
  
  // Price not already pumping
  if (priceData.priceChange7d < 3) score += 8;
  
  // Discount for mercenary capital risk
  score -= 12;
  
  return Math.min(80, score);
}

/**
 * SCAN: Funding/OI-based positioning signals
 * Detects: Fade trades, Squeeze setups, Volatility expansion plays
 */
async function scanPositioningSignals() {
  logger.info('Scanning for positioning-based signals...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_ASSETS.map(a => a.id);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const asset of SCAN_ASSETS) {
      const price = marketData[asset.id];
      if (!price || !price.sparkline || price.sparkline.length < 48) continue;
      
      // Skip low-volume assets
      const volumeRatio = price.volume24h / price.marketCap;
      if (volumeRatio < SIGNAL_THRESHOLDS.MIN_VOLUME_RATIO) continue;
      
      // Analyze positioning
      const positioning = analyzePositioning(price);
      if (!positioning) continue;
      
      // Calculate volatility
      const volatility = calculateVolatility(price.sparkline);
      
      // Classify trade setup
      const tradeSetup = classifyTradeSetup(positioning, volatility);
      
      // REJECT weak signals
      if (!tradeSetup.valid) {
        logger.debug(`Rejected ${asset.symbol}: ${tradeSetup.reason}`);
        continue;
      }
      
      // Calculate confidence score
      const confidence = calculatePositioningConfidence(positioning, tradeSetup, volatility);
      
      // REJECT low confidence
      if (confidence < SIGNAL_THRESHOLDS.MIN_CONFIDENCE) {
        logger.debug(`Rejected ${asset.symbol}: Low confidence (${confidence})`);
        continue;
      }
      
      // Generate signal based on trade type
      const signal = generatePositioningSignal(asset, price, positioning, tradeSetup, volatility, confidence);
      if (signal) signals.push(signal);
    }
  } catch (err) {
    logger.error('Positioning scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * Generate signal object for positioning-based trades
 */
function generatePositioningSignal(asset, price, positioning, tradeSetup, volatility, confidence) {
  const { tradeType, direction, conviction, rationale } = tradeSetup;
  const sparkline = price.sparkline;
  const high7d = Math.max(...sparkline);
  const low7d = Math.min(...sparkline);
  
  let signalType, marketContext, observedAnomaly, whyMatters, tradeExpression, timeHorizon, keyRisks, invalidationLevel;
  
  if (tradeType === 'FADE') {
    signalType = 'FADE_TRADE';
    marketContext = `${asset.symbol} at $${formatNumber(price.price)}. Funding bias: ${positioning.dominantBias.replace('persistent_', '')} for ${positioning.persistence} periods. Price position: ${(positioning.pricePosition * 100).toFixed(0)}% of 24h range. Stress score: ${positioning.stressScore}/100.`;
    observedAnomaly = `${positioning.crowding === 'crowded_longs' ? 'Crowded long' : 'Crowded short'} positioning detected. Volume/MCap: ${(positioning.volumeRatio * 100).toFixed(1)}%. ${positioning.priceDiverges ? 'Price DIVERGING from positioning bias.' : 'Price at extreme without reversal yet.'}`;
    whyMatters = rationale + ` High funding costs erode leveraged positions. Mean reversion probability increases at positioning extremes.`;
    
    const targetPrice = positioning.crowding === 'crowded_longs'
      ? (price.high24h + price.low24h) / 2  // Target VWAP for short
      : (price.high24h + price.low24h) / 2; // Target VWAP for long
    
    tradeExpression = direction === 'SHORT'
      ? `Fade longs: Short ${asset.symbol} at $${formatNumber(price.price)}. Target: VWAP ~$${formatNumber(targetPrice)} (-${((price.price - targetPrice) / price.price * 100).toFixed(1)}%). Use tight stop.`
      : `Fade shorts: Long ${asset.symbol} at $${formatNumber(price.price)}. Target: VWAP ~$${formatNumber(targetPrice)} (+${((targetPrice - price.price) / price.price * 100).toFixed(1)}%). Use tight stop.`;
    
    timeHorizon = '4-24 hours';
    keyRisks = 'Trend continuation, news catalyst, exchange-specific dynamics. Fade trades require precise timing.';
    invalidationLevel = direction === 'SHORT'
      ? `New 24h high above $${formatNumber(price.high24h * 1.015)}`
      : `New 24h low below $${formatNumber(price.low24h * 0.985)}`;
      
  } else if (tradeType === 'SQUEEZE') {
    signalType = 'SQUEEZE_SETUP';
    marketContext = `${asset.symbol} at $${formatNumber(price.price)}. High leverage indicated: Vol/MCap ${(positioning.volumeRatio * 100).toFixed(1)}%. Funding ${positioning.dominantBias.replace('persistent_', '')} but price DIVERGING.`;
    observedAnomaly = `Price divergence from persistent ${positioning.dominantBias.replace('persistent_', '')} funding. 7d return: ${positioning.totalReturn7d > 0 ? '+' : ''}${positioning.totalReturn7d.toFixed(1)}% vs ${positioning.dominantBias.replace('persistent_', '')} funding bias. Liquidation cascade potential.`;
    whyMatters = rationale + ` When price moves against crowded positioning, stop losses and liquidations create cascading effect.`;
    
    const squeezeTarget = direction === 'LONG'
      ? high7d * 1.05  // 5% above 7d high
      : low7d * 0.95;  // 5% below 7d low
    
    tradeExpression = direction === 'LONG'
      ? `Squeeze play: Long ${asset.symbol} on break above $${formatNumber(high7d)}. Target: $${formatNumber(squeezeTarget)} (short liquidation zone). Scale in on confirmation.`
      : `Squeeze play: Short ${asset.symbol} on break below $${formatNumber(low7d)}. Target: $${formatNumber(squeezeTarget)} (long liquidation zone). Scale in on confirmation.`;
    
    timeHorizon = '1-3 days';
    keyRisks = 'False breakout, insufficient open interest for cascade, broader market correlation override.';
    invalidationLevel = direction === 'LONG'
      ? `Rejection at $${formatNumber(high7d)} or new low below $${formatNumber(low7d * 0.98)}`
      : `Rejection at $${formatNumber(low7d)} or new high above $${formatNumber(high7d * 1.02)}`;
      
  } else if (tradeType === 'VOL_EXPANSION') {
    signalType = 'VOL_EXPANSION';
    marketContext = `${asset.symbol} volatility compressed to ${(volatility * 100).toFixed(2)}% (threshold: <${SIGNAL_THRESHOLDS.VOL_COMPRESSION_THRESHOLD * 100}%). Volume/MCap: ${(positioning.volumeRatio * 100).toFixed(1)}%. Position buildup: ${positioning.persistence} periods of ${positioning.dominantBias.replace('persistent_', '')} bias.`;
    observedAnomaly = `Volatility compression with significant position buildup. Range: $${formatNumber(low7d)} - $${formatNumber(high7d)} (${((high7d - low7d) / low7d * 100).toFixed(1)}% band). Breakout imminent.`;
    whyMatters = rationale + ` Compressed volatility acts like coiled spring. Directional bias from positioning suggests likely breakout direction.`;
    
    const breakoutTarget = direction === 'LONG'
      ? high7d * 1.08  // 8% above high
      : low7d * 0.92;  // 8% below low
    
    tradeExpression = direction === 'LONG'
      ? `Vol expansion: Long ${asset.symbol} on break of $${formatNumber(high7d)}. Target: $${formatNumber(breakoutTarget)} (8% expansion). Trail stop at breakout level.`
      : `Vol expansion: Short ${asset.symbol} on break of $${formatNumber(low7d)}. Target: $${formatNumber(breakoutTarget)} (8% expansion). Trail stop at breakout level.`;
    
    timeHorizon = '24-72 hours';
    keyRisks = 'False breakout, range extension rather than trend, low liquidity slippage.';
    invalidationLevel = direction === 'LONG'
      ? `Close below $${formatNumber((high7d + low7d) / 2)} after breakout`
      : `Close above $${formatNumber((high7d + low7d) / 2)} after breakout`;
  } else {
    return null;
  }
  
  return formatSignal({
    signalType,
    tradeType,
    asset: asset.symbol,
    direction,
    marketContext,
    observedAnomaly,
    whyMatters,
    tradeExpression,
    timeHorizon,
    keyRisks,
    invalidationLevel,
    confidenceScore: confidence,
    positioningAnalysis: {
      dominantBias: positioning.dominantBias,
      persistence: positioning.persistence,
      stressScore: positioning.stressScore,
      crowding: positioning.crowding,
      pricePosition: positioning.pricePosition,
      conviction
    },
    rawData: {
      price: price.price,
      high24h: price.high24h,
      low24h: price.low24h,
      high7d,
      low7d,
      volumeRatio: positioning.volumeRatio,
      volatility,
      volCompression: volatility,
      totalReturn7d: positioning.totalReturn7d,
      stressScore: positioning.stressScore,
      persistence: positioning.persistence,
      fundingDiverged: positioning.priceDiverges
    },
    dataSources: ['CoinGecko']
  });
}

/**
 * Calculate confidence score for positioning signals
 */
function calculatePositioningConfidence(positioning, tradeSetup, volatility) {
  let score = 35; // Base score
  
  // Stress score contribution
  if (positioning.stressScore >= 70) score += 20;
  else if (positioning.stressScore >= 50) score += 12;
  else if (positioning.stressScore >= 30) score += 5;
  
  // Persistence contribution
  if (positioning.persistence >= 5) score += 15;
  else if (positioning.persistence >= 3) score += 8;
  
  // Price divergence bonus (stronger signal)
  if (positioning.priceDiverges) score += 10;
  
  // Conviction from trade classification
  if (tradeSetup.conviction === 'high') score += 10;
  else if (tradeSetup.conviction === 'medium') score += 5;
  
  // Volatility context
  if (tradeSetup.tradeType === 'VOL_EXPANSION' && volatility < 0.015) score += 8;
  if (tradeSetup.tradeType === 'FADE' && positioning.pricePosition > 0.9 || positioning.pricePosition < 0.1) score += 8;
  
  // Discount for data quality (using proxy, not direct funding)
  score -= 8;
  
  return Math.min(80, score);
}

/**
 * Legacy funding sentiment estimator (kept for backward compatibility)
 */
function estimateFundingSentiment(priceData) {
  if (!priceData) return null;
  
  const volumeRatio = priceData.volume24h / priceData.marketCap;
  const priceDirection = priceData.priceChange24h > 0 ? 1 : -1;
  const fundingEstimate = volumeRatio * priceDirection * 100;
  
  return {
    estimated: true,
    value: Math.max(-0.1, Math.min(0.1, fundingEstimate / 1000)),
    sentiment: fundingEstimate > 0.02 ? 'crowded_long' : fundingEstimate < -0.02 ? 'crowded_short' : 'neutral',
    confidence: 40
  };
}

/**
 * SCAN TYPE 2: TVL Lag (kept for protocol analysis)
 */
async function scanTVLLag() {
  logger.info('Scanning for TVL-price divergence...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_PROTOCOLS.map(p => p.token);
    const marketData = await fetchMarketData(tokenIds);
    
    for (const protocol of SCAN_PROTOCOLS) {
      const tvlData = await fetchTVLData(protocol.slug);
      const priceData = marketData[protocol.token];
      
      if (!tvlData || !priceData) continue;
      
      const tvlGrowth7d = tvlData.tvlChange7d;
      const priceGrowth7d = priceData.priceChange7d || 0;
      const divergence = tvlGrowth7d - priceGrowth7d;
      
      // REJECT: Weak divergence
      if (divergence < SIGNAL_THRESHOLDS.MIN_DIVERGENCE) continue;
      if (tvlGrowth7d < 3) continue; // No TVL growth
      
      const isAccelerating = tvlData.tvlAcceleration > 2;
      const tvlPerMcap = tvlData.currentTvl / priceData.marketCap;
      
      const signal = formatSignal({
        signalType: 'TVL_LAG',
        tradeType: 'FUNDAMENTAL',
        asset: `${protocol.name} (${priceData.symbol})`,
        direction: 'LONG',
        marketContext: `${protocol.name} TVL: $${formatNumber(tvlData.currentTvl)}. 7d TVL change: +${tvlGrowth7d.toFixed(2)}%. Token price 7d: ${priceGrowth7d > 0 ? '+' : ''}${priceGrowth7d.toFixed(2)}%. TVL/MCap ratio: ${tvlPerMcap.toFixed(2)}x.`,
        observedAnomaly: `TVL growth (+${tvlGrowth7d.toFixed(2)}%) outpacing token appreciation (${priceGrowth7d.toFixed(2)}%). Divergence: ${divergence.toFixed(2)}%. ${isAccelerating ? 'TVL growth ACCELERATING.' : ''}`,
        whyMatters: `Capital flowing into protocol but token price lagging. Protocol revenue correlates with TVL over medium term. Market hasn't priced in fundamental improvement.`,
        tradeExpression: `Long ${priceData.symbol} spot. Target: ${(divergence * 0.5).toFixed(1)}% catch-up move.`,
        timeHorizon: '1-2 weeks',
        keyRisks: 'Mercenary TVL, token inflation, smart contract risk, market downturn',
        invalidationLevel: `TVL drops >10% or price below $${formatNumber(priceData.price * 0.85)}`,
        confidenceScore: calculateTVLLagConfidence(tvlData, priceData, divergence),
        rawData: { 
          tvl: tvlData.currentTvl, 
          tvlChange7d: tvlGrowth7d, 
          tvlChange30d: tvlData.tvlChange30d || tvlGrowth7d * 2,
          priceChange7d: priceGrowth7d, 
          priceChange30d: priceData.priceChange30d || priceGrowth7d,
          divergence, 
          tvlPerMcap,
          tvlAccelerating: isAccelerating
        },
        dataSources: ['DeFiLlama', 'CoinGecko']
      });
      
      signals.push(signal);
    }
  } catch (err) {
    logger.error('TVL lag scan failed', { error: err.message });
  }
  
  return signals;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateVolatility(prices) {
  if (!prices || prices.length < 2) return 0;
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  
  return Math.sqrt(variance);
}

function calculateOIConfidence(price, volatility) {
  let score = 40; // Base score
  
  // Higher volume = more confidence
  const volumeRatio = price.volume24h / price.marketCap;
  if (volumeRatio > 0.15) score += 15;
  else if (volumeRatio > 0.1) score += 10;
  
  // Lower volatility = clearer compression
  if (volatility < 0.015) score += 15;
  else if (volatility < 0.02) score += 10;
  
  // Flat price = clearer signal
  if (Math.abs(price.priceChange7d) < 3) score += 10;
  
  // Discount for data quality
  score -= 10; // CoinGecko data delay penalty
  
  return Math.min(75, score);
}

function calculateTVLLagConfidence(tvlData, priceData, divergence) {
  let score = 35; // Base score
  
  // Larger divergence = stronger signal
  if (divergence > 15) score += 20;
  else if (divergence > 10) score += 12;
  else if (divergence > 5) score += 5;
  
  // TVL acceleration adds confidence
  if (tvlData.tvlAcceleration > 5) score += 15;
  else if (tvlData.tvlAcceleration > 2) score += 8;
  
  // Higher TVL = more reliable data
  if (tvlData.currentTvl > 1e9) score += 10;
  else if (tvlData.currentTvl > 100e6) score += 5;
  
  // Price not already pumping
  if (priceData.priceChange7d < 5) score += 5;
  
  // Discount for mercenary capital risk
  score -= 10;
  
  return Math.min(80, score);
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  if (num < 1) return num.toFixed(6);
  return num.toFixed(2);
}

// ============================================================================
// MAIN SCANNER CLASS
// ============================================================================

class AlphaScanner {
  constructor(config = {}) {
    this.config = {
      minConfidence: SIGNAL_THRESHOLDS.MIN_CONFIDENCE,
      maxSignals: 15,
      includeYieldScans: true,
      includeDevScans: true,
      ...config
    };
  }
  
  /**
   * Run all scans and return ranked signals
   * Includes: Positioning, TVL, Yield Spikes, TVL Inflow Lead, Dev Activity, Narrative
   */
  async scan() {
    logger.info('Starting comprehensive alpha scan (including DeFi yield + dev activity analysis)...');
    const startTime = Date.now();
    
    const allSignals = [];
    
    // Run all scans in parallel
    const scanPromises = [
      scanPositioningSignals(),
      scanTVLLag()
    ];
    
    // Add yield scans if enabled
    if (this.config.includeYieldScans) {
      scanPromises.push(scanYieldSpikes());
      scanPromises.push(scanTVLInflowLead());
    }
    
    // Add dev/narrative scans if enabled
    if (this.config.includeDevScans) {
      scanPromises.push(scanDevActivityLead());
      scanPromises.push(scanNarrativeLead());
    }
    
    const results = await Promise.all(scanPromises);
    results.forEach(signals => allSignals.push(...signals));
    
    // Apply strict filtering - REJECT weak or ambiguous signals
    const filtered = allSignals
      .filter(s => {
        // Must meet minimum confidence
        if (s.confidenceScore < this.config.minConfidence) return false;
        
        // Must have valid trade type
        if (!s.tradeType || s.tradeType === 'UNKNOWN') return false;
        
        // Must have conviction level (reject LOW unless explicitly configured)
        if (s.conviction && s.conviction === 'LOW') return false;
        
        return true;
      })
      .sort((a, b) => {
        // Sort by confidence, then by conviction level
        const convictionOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
        const aConv = convictionOrder[a.conviction] || 2;
        const bConv = convictionOrder[b.conviction] || 2;
        
        if (b.confidenceScore !== a.confidenceScore) {
          return b.confidenceScore - a.confidenceScore;
        }
        return bConv - aConv;
      })
      .slice(0, this.config.maxSignals);
    
    logger.info(`Scan complete. Found ${filtered.length} actionable signals.`, {
      total: allSignals.length,
      filtered: filtered.length,
      rejected: allSignals.length - filtered.length,
      durationMs: Date.now() - startTime
    });
    
    return {
      signals: filtered,
      summary: this.generateSummary(filtered),
      metadata: {
        scannedAssets: SCAN_ASSETS.length,
        scannedProtocols: SCAN_PROTOCOLS.length,
        timestamp: new Date().toISOString(),
        executionTimeMs: Date.now() - startTime,
        signalTypes: this.countByType(filtered),
        includesYieldAnalysis: this.config.includeYieldScans,
        includesDevAnalysis: this.config.includeDevScans
      }
    };
  }
  
  /**
   * Run specific scan type
   */
  async scanType(type) {
    switch (type) {
      case 'positioning':
        return await scanPositioningSignals();
      case 'tvl_lag':
        return await scanTVLLag();
      case 'yield_spike':
        return await scanYieldSpikes();
      case 'tvl_inflow_lead':
        return await scanTVLInflowLead();
      case 'dev_activity':
        return await scanDevActivityLead();
      case 'narrative':
        return await scanNarrativeLead();
      case 'fade':
        const fadeSignals = await scanPositioningSignals();
        return fadeSignals.filter(s => s.tradeType === 'FADE_TRADE');
      case 'squeeze':
        const squeezeSignals = await scanPositioningSignals();
        return squeezeSignals.filter(s => s.tradeType === 'SQUEEZE_SETUP');
      case 'vol_expansion':
        const volSignals = await scanPositioningSignals();
        return volSignals.filter(s => s.tradeType === 'VOL_EXPANSION');
      case 'yield':
        // All yield-related signals
        const [yieldSpikes, tvlLead] = await Promise.all([
          scanYieldSpikes(),
          scanTVLInflowLead()
        ]);
        return [...yieldSpikes, ...tvlLead];
      case 'fundamentals':
        // All dev/narrative signals
        const [devSignals, narrativeSignals] = await Promise.all([
          scanDevActivityLead(),
          scanNarrativeLead()
        ]);
        return [...devSignals, ...narrativeSignals];
      default:
        return [];
    }
  }
  
  countByType(signals) {
    return signals.reduce((acc, s) => {
      acc[s.tradeType || s.signalType] = (acc[s.tradeType || s.signalType] || 0) + 1;
      return acc;
    }, {});
  }
  
  generateSummary(signals) {
    if (signals.length === 0) {
      return 'No actionable signals detected. Market positioning appears balanced. DeFi yields stable. Waiting for clearer setups.';
    }
    
    const byType = this.countByType(signals);
    
    const topSignal = signals[0];
    const typeBreakdown = Object.entries(byType)
      .map(([type, count]) => `${type.replace(/_/g, ' ')}: ${count}`)
      .join(', ');
    
    const highConviction = signals.filter(s => s.conviction === 'HIGH').length;
    const yieldSignals = signals.filter(s => 
      s.signalType === 'YIELD_SPIKE' || s.signalType === 'TVL_INFLOW_LEAD'
    ).length;
    const devSignals = signals.filter(s => 
      s.signalType === 'DEV_ACTIVITY_LEAD' || s.signalType === 'NARRATIVE_LEAD'
    ).length;
    
    let summary = `Found ${signals.length} actionable signals (${highConviction} high conviction).`;
    if (yieldSignals > 0) {
      summary += ` Including ${yieldSignals} DeFi yield opportunities.`;
    }
    if (devSignals > 0) {
      summary += ` Including ${devSignals} dev/narrative lead signals.`;
    }
    summary += ` Top: ${topSignal.asset} ${topSignal.tradeType || topSignal.signalType} (${topSignal.confidenceScore}% confidence). Breakdown: ${typeBreakdown}`;
    
    return summary;
  }
}

module.exports = {
  AlphaScanner,
  // Scan functions
  scanPositioningSignals,
  scanTVLLag,
  scanYieldSpikes,
  scanTVLInflowLead,
  scanDevActivityLead,
  scanNarrativeLead,
  // Analysis functions
  analyzePositioning,
  analyzeYieldDynamics,
  analyzeTVLPriceLeadLag,
  analyzeDevActivityMismatch,
  analyzeNarrativeMismatch,
  classifyTradeSetup,
  // Utilities
  formatSignal,
  fetchYieldData,
  fetchTVLData,
  fetchGitHubActivity,
  fetchProtocolRanking,
  // On-chain data
  fetchOnChainMetrics,
  fetchExchangeReserves,
  fetchNetworkFees,
  // Constants
  SCAN_ASSETS,
  SCAN_PROTOCOLS,
  SIGNAL_THRESHOLDS
};
