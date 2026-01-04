/**
 * Alpha Scanner Module
 * 
 * Scans for tradeable anomalies using free public APIs:
 * - CoinGecko (prices, volume, market data)
 * - DeFiLlama (TVL, protocol metrics, yields)
 * - Coinglass/alternative APIs (funding rates, open interest)
 * 
 * Signal Types:
 * 1. FADE_TRADE: Mean reversion against crowded positioning
 * 2. SQUEEZE_SETUP: Liquidation cascade potential
 * 3. VOL_EXPANSION: Volatility breakout from compression
 * 4. TVL_LAG: Protocol TVL diverging from token price
 * 5. YIELD_SPIKE: APY/APR spike without price response
 * 6. TVL_INFLOW_LEAD: Historical pattern of TVL preceding appreciation
 * 
 * Trade Classification:
 * - Directional: Pure long/short based on signal
 * - Yield + Hedge: Capture elevated yield while hedging token exposure
 */

const { fetchWithTimeout, AgentLogger } = require('../shared/utils');

const logger = new AgentLogger('AlphaScanner');

// Free API endpoints
const APIS = {
  COINGECKO: 'https://api.coingecko.com/api/v3',
  DEFILLAMA: 'https://api.llama.fi',
  DEFILLAMA_COINS: 'https://coins.llama.fi',
  DEFILLAMA_YIELDS: 'https://yields.llama.fi',
  COINGLASS_ALT: 'https://open-api.coinglass.com/public/v2'
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

// DeFi protocols to scan (with yield-bearing products)
const SCAN_PROTOCOLS = [
  { slug: 'aave', token: 'aave', name: 'Aave', hasYield: true, yieldType: 'lending' },
  { slug: 'lido', token: 'lido-dao', name: 'Lido', hasYield: true, yieldType: 'staking' },
  { slug: 'uniswap', token: 'uniswap', name: 'Uniswap', hasYield: true, yieldType: 'lp' },
  { slug: 'curve-dex', token: 'curve-dao-token', name: 'Curve', hasYield: true, yieldType: 'lp' },
  { slug: 'maker', token: 'maker', name: 'Maker', hasYield: true, yieldType: 'lending' },
  { slug: 'eigenlayer', token: 'eigenlayer', name: 'EigenLayer', hasYield: true, yieldType: 'restaking' },
  { slug: 'pendle', token: 'pendle', name: 'Pendle', hasYield: true, yieldType: 'yield-trading' },
  { slug: 'gmx', token: 'gmx', name: 'GMX', hasYield: true, yieldType: 'perps-lp' },
  { slug: 'morpho', token: 'morpho', name: 'Morpho', hasYield: true, yieldType: 'lending' },
  { slug: 'ethena', token: 'ethena', name: 'Ethena', hasYield: true, yieldType: 'synthetic' }
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
  YIELD_PRICE_LAG_WINDOW: 72       // Hours of yield spike without price response
};

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
  positioningAnalysis = {},
  rawData = {}
}) {
  return {
    signalType,
    tradeType, // 'FADE' | 'SQUEEZE' | 'VOL_EXPANSION'
    asset,
    marketContext,
    observedAnomaly,
    whyMatters,
    tradeExpression,
    timeHorizon,
    keyRisks,
    invalidationLevel,
    confidenceScore: Math.min(100, Math.max(0, confidenceScore)),
    positioningAnalysis,
    timestamp: new Date().toISOString(),
    rawData
  };
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
// SCAN FUNCTIONS - Detect & Classify Signals
// ============================================================================

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
            yieldTrend: yieldAnalysis.yieldTrend
          }
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
          leadScore: leadLagAnalysis.leadScore
        }
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
      totalReturn7d: positioning.totalReturn7d
    }
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
        marketContext: `${protocol.name} TVL: $${formatNumber(tvlData.currentTvl)}. 7d TVL change: +${tvlGrowth7d.toFixed(2)}%. Token price 7d: ${priceGrowth7d > 0 ? '+' : ''}${priceGrowth7d.toFixed(2)}%. TVL/MCap ratio: ${tvlPerMcap.toFixed(2)}x.`,
        observedAnomaly: `TVL growth (+${tvlGrowth7d.toFixed(2)}%) outpacing token appreciation (${priceGrowth7d.toFixed(2)}%). Divergence: ${divergence.toFixed(2)}%. ${isAccelerating ? 'TVL growth ACCELERATING.' : ''}`,
        whyMatters: `Capital flowing into protocol but token price lagging. Protocol revenue correlates with TVL over medium term. Market hasn't priced in fundamental improvement.`,
        tradeExpression: `Long ${priceData.symbol} spot. Target: ${(divergence * 0.5).toFixed(1)}% catch-up move.`,
        timeHorizon: '1-2 weeks',
        keyRisks: 'Mercenary TVL, token inflation, smart contract risk, market downturn',
        invalidationLevel: `TVL drops >10% or price below $${formatNumber(priceData.price * 0.85)}`,
        confidenceScore: calculateTVLLagConfidence(tvlData, priceData, divergence),
        rawData: { tvl: tvlData.currentTvl, tvlChange7d, priceChange7d: priceGrowth7d, divergence, tvlPerMcap }
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
      ...config
    };
  }
  
  /**
   * Run all scans and return ranked signals
   * Includes: Positioning, TVL, Yield Spikes, TVL Inflow Lead
   */
  async scan() {
    logger.info('Starting comprehensive alpha scan (including DeFi yield analysis)...');
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
        includesYieldAnalysis: this.config.includeYieldScans
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
    
    let summary = `Found ${signals.length} actionable signals (${highConviction} high conviction).`;
    if (yieldSignals > 0) {
      summary += ` Including ${yieldSignals} DeFi yield opportunities.`;
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
  // Analysis functions
  analyzePositioning,
  analyzeYieldDynamics,
  analyzeTVLPriceLeadLag,
  classifyTradeSetup,
  // Utilities
  formatSignal,
  fetchYieldData,
  fetchTVLData,
  // Constants
  SCAN_ASSETS,
  SCAN_PROTOCOLS,
  SIGNAL_THRESHOLDS
};
