/**
 * Alpha Scanner Module
 * 
 * Scans for tradeable anomalies using free public APIs:
 * - CoinGecko (prices, volume, market data)
 * - DeFiLlama (TVL, protocol metrics)
 * - Coinglass/alternative APIs (funding rates, open interest)
 * 
 * Signal Types:
 * 1. FADE_TRADE: Mean reversion against crowded positioning
 * 2. SQUEEZE_SETUP: Liquidation cascade potential
 * 3. VOL_EXPANSION: Volatility breakout from compression
 * 4. TVL_LAG: Protocol TVL diverging from token price
 * 
 * Trade Classification:
 * - Fade: Counter-trend against crowded positions
 * - Squeeze: Breakout that triggers liquidation cascade
 * - Volatility Expansion: Directional breakout from range
 */

const { fetchWithTimeout, AgentLogger } = require('../shared/utils');

const logger = new AgentLogger('AlphaScanner');

// Free API endpoints
const APIS = {
  COINGECKO: 'https://api.coingecko.com/api/v3',
  DEFILLAMA: 'https://api.llama.fi',
  DEFILLAMA_COINS: 'https://coins.llama.fi',
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

// DeFi protocols to scan
const SCAN_PROTOCOLS = [
  { slug: 'aave', token: 'aave', name: 'Aave' },
  { slug: 'lido', token: 'lido-dao', name: 'Lido' },
  { slug: 'uniswap', token: 'uniswap', name: 'Uniswap' },
  { slug: 'curve-dex', token: 'curve-dao-token', name: 'Curve' },
  { slug: 'maker', token: 'maker', name: 'Maker' },
  { slug: 'eigenlayer', token: 'eigenlayer', name: 'EigenLayer' },
  { slug: 'pendle', token: 'pendle', name: 'Pendle' },
  { slug: 'gmx', token: 'gmx', name: 'GMX' },
  { slug: 'morpho', token: 'morpho', name: 'Morpho' },
  { slug: 'ethena', token: 'ethena', name: 'Ethena' }
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
  SQUEEZE_LEVERAGE_THRESHOLD: 0.12 // Volume/MCap suggesting leverage
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

// ============================================================================
// SCAN FUNCTIONS - Detect & Classify Signals
// ============================================================================

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
      maxSignals: 10,
      ...config
    };
  }
  
  /**
   * Run all scans and return ranked signals
   * Includes new positioning-based signal detection
   */
  async scan() {
    logger.info('Starting comprehensive alpha scan...');
    const startTime = Date.now();
    
    const allSignals = [];
    
    // Run all scans in parallel (including new positioning analysis)
    const [positioningSignals, tvlSignals] = await Promise.all([
      scanPositioningSignals(),
      scanTVLLag()
    ]);
    
    allSignals.push(...positioningSignals, ...tvlSignals);
    
    // Apply strict filtering - REJECT weak or ambiguous signals
    const filtered = allSignals
      .filter(s => {
        // Must meet minimum confidence
        if (s.confidenceScore < this.config.minConfidence) return false;
        
        // Must have valid trade type
        if (!s.tradeType || s.tradeType === 'UNKNOWN') return false;
        
        // Must have conviction level
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
        signalTypes: this.countByType(filtered)
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
      case 'fade':
        const signals = await scanPositioningSignals();
        return signals.filter(s => s.tradeType === 'FADE_TRADE');
      case 'squeeze':
        const squeezeSignals = await scanPositioningSignals();
        return squeezeSignals.filter(s => s.tradeType === 'SQUEEZE_SETUP');
      case 'vol_expansion':
        const volSignals = await scanPositioningSignals();
        return volSignals.filter(s => s.tradeType === 'VOL_EXPANSION');
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
      return 'No actionable signals detected. Market positioning appears balanced with no significant anomalies. Waiting for clearer setups.';
    }
    
    const byType = this.countByType(signals);
    
    const topSignal = signals[0];
    const typeBreakdown = Object.entries(byType)
      .map(([type, count]) => `${type.replace('_', ' ')}: ${count}`)
      .join(', ');
    
    const highConviction = signals.filter(s => s.conviction === 'HIGH').length;
    
    return `Found ${signals.length} actionable signals (${highConviction} high conviction). Top: ${topSignal.asset} ${topSignal.tradeType || topSignal.signalType} (${topSignal.confidenceScore}% confidence, ${topSignal.conviction || 'MEDIUM'} conviction). Breakdown: ${typeBreakdown}`;
  }
}

module.exports = {
  AlphaScanner,
  scanPositioningSignals,
  scanTVLLag,
  analyzePositioning,
  classifyTradeSetup,
  formatSignal,
  SCAN_ASSETS,
  SCAN_PROTOCOLS,
  SIGNAL_THRESHOLDS
};
