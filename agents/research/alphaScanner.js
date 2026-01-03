/**
 * Alpha Scanner Module
 * 
 * Scans for tradeable anomalies using free public APIs:
 * - CoinGecko (prices, volume, market data)
 * - DeFiLlama (TVL, protocol metrics)
 * - Coinglass/alternative APIs (funding rates, open interest)
 * 
 * Signal Types:
 * 1. OI Divergence: Rising open interest + flat price
 * 2. TVL Lag: Accelerating TVL + lagging token price
 * 3. Funding Divergence: Cross-exchange funding rate anomalies
 */

const { fetchWithTimeout, AgentLogger } = require('../shared/utils');

const logger = new AgentLogger('AlphaScanner');

// Free API endpoints
const APIS = {
  COINGECKO: 'https://api.coingecko.com/api/v3',
  DEFILLAMA: 'https://api.llama.fi',
  DEFILLAMA_COINS: 'https://coins.llama.fi',
  COINGLASS_ALT: 'https://open-api.coinglass.com/public/v2' // Limited free tier
};

// Assets to scan
const SCAN_ASSETS = [
  { id: 'bitcoin', symbol: 'BTC', defillamaId: null },
  { id: 'ethereum', symbol: 'ETH', defillamaId: null },
  { id: 'solana', symbol: 'SOL', defillamaId: null },
  { id: 'avalanche-2', symbol: 'AVAX', defillamaId: null },
  { id: 'arbitrum', symbol: 'ARB', defillamaId: 'arbitrum' },
  { id: 'optimism', symbol: 'OP', defillamaId: 'optimism' }
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

/**
 * Standard output schema for signals
 */
function formatSignal({
  signalType,
  marketContext,
  observedAnomaly,
  whyMatters,
  tradeExpression,
  timeHorizon,
  keyRisks,
  invalidationLevel,
  confidenceScore,
  asset,
  rawData = {}
}) {
  return {
    signalType,
    asset,
    marketContext,
    observedAnomaly,
    whyMatters,
    tradeExpression,
    timeHorizon,
    keyRisks,
    invalidationLevel,
    confidenceScore: Math.min(100, Math.max(0, confidenceScore)),
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
 * Fetch derivatives data (OI, funding) - using free alternatives
 * Note: Full OI data requires paid APIs, using estimation methods
 */
async function fetchDerivativesData(symbol) {
  try {
    // CoinGecko derivatives endpoint (limited but free)
    const url = `${APIS.COINGECKO}/derivatives/exchanges?per_page=10`;
    const res = await fetchWithTimeout(url, { timeout: 10000 });
    
    if (!res.ok) return null;
    
    const exchanges = await res.json();
    
    // Aggregate OI estimates from exchanges
    const exchangeData = exchanges.map(ex => ({
      name: ex.name,
      openInterestBtc: ex.open_interest_btc,
      tradeVolume24hBtc: ex.trade_volume_24h_btc
    }));
    
    return {
      exchanges: exchangeData,
      totalOI: exchangeData.reduce((sum, ex) => sum + (ex.openInterestBtc || 0), 0),
      totalVolume: exchangeData.reduce((sum, ex) => sum + (ex.tradeVolume24hBtc || 0), 0)
    };
  } catch (err) {
    logger.debug('Failed to fetch derivatives data', { error: err.message });
    return null;
  }
}

/**
 * Estimate funding rate sentiment from volume/price dynamics
 * (Approximation when direct funding API unavailable)
 */
function estimateFundingSentiment(priceData) {
  if (!priceData) return null;
  
  // High volume + positive price = likely positive funding
  // High volume + negative price = likely negative funding
  const volumeRatio = priceData.volume24h / priceData.marketCap;
  const priceDirection = priceData.priceChange24h > 0 ? 1 : -1;
  
  // Normalize
  const fundingEstimate = volumeRatio * priceDirection * 100;
  
  return {
    estimated: true,
    value: Math.max(-0.1, Math.min(0.1, fundingEstimate / 1000)), // Clamp to realistic range
    sentiment: fundingEstimate > 0.02 ? 'crowded_long' : fundingEstimate < -0.02 ? 'crowded_short' : 'neutral',
    confidence: 40 // Low confidence since estimated
  };
}

/**
 * SCAN TYPE 1: OI Divergence
 * Rising open interest but flat/declining price
 * Indicates: Position buildup, potential squeeze setup
 */
async function scanOIDivergence() {
  logger.info('Scanning for OI divergence...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_ASSETS.map(a => a.id);
    const marketData = await fetchMarketData(tokenIds);
    const derivativesData = await fetchDerivativesData('BTC');
    
    for (const asset of SCAN_ASSETS) {
      const price = marketData[asset.id];
      if (!price) continue;
      
      // Check for flat price with high volume (proxy for OI buildup)
      const priceFlat = Math.abs(price.priceChange7d) < 5; // <5% change
      const volumeHigh = price.volume24h > price.marketCap * 0.1; // >10% of mcap
      const recentVolatility = calculateVolatility(price.sparkline);
      const volatilityCompressing = recentVolatility < 0.02; // Low recent vol
      
      if (priceFlat && volumeHigh && volatilityCompressing) {
        // Determine likely positioning
        const avgPrice7d = price.sparkline.reduce((a, b) => a + b, 0) / price.sparkline.length;
        const currentVsAvg = ((price.price - avgPrice7d) / avgPrice7d) * 100;
        const likelyOffsides = currentVsAvg > 0 ? 'late longs' : 'late shorts';
        
        const signal = formatSignal({
          signalType: 'OI_DIVERGENCE',
          asset: asset.symbol,
          marketContext: `${asset.symbol} showing compressed volatility (${(recentVolatility * 100).toFixed(2)}%) with elevated volume ($${formatNumber(price.volume24h)}). Price flat over 7d (${price.priceChange7d?.toFixed(2)}%).`,
          observedAnomaly: `High trading activity without directional follow-through. Volume/MCap ratio: ${((price.volume24h / price.marketCap) * 100).toFixed(2)}%. This typically precedes breakouts.`,
          whyMatters: `Position buildup during range compression often leads to liquidation cascades when price breaks. ${likelyOffsides === 'late longs' ? 'Longs accumulated near resistance' : 'Shorts accumulated near support'} are likely offsides.`,
          tradeExpression: likelyOffsides === 'late longs' 
            ? `Short ${asset.symbol} on breakdown below 7d low ($${formatNumber(Math.min(...price.sparkline))}), target 5-8% move` 
            : `Long ${asset.symbol} on breakout above 7d high ($${formatNumber(Math.max(...price.sparkline))}), target 5-8% move`,
          timeHorizon: '24-72 hours',
          keyRisks: 'False breakout, news catalyst overriding technical setup, low liquidity slippage',
          invalidationLevel: likelyOffsides === 'late longs' 
            ? `Above $${formatNumber(Math.max(...price.sparkline) * 1.02)}` 
            : `Below $${formatNumber(Math.min(...price.sparkline) * 0.98)}`,
          confidenceScore: calculateOIConfidence(price, recentVolatility),
          rawData: {
            price: price.price,
            priceChange7d: price.priceChange7d,
            volume24h: price.volume24h,
            volatility: recentVolatility,
            sparkline: price.sparkline.slice(-24)
          }
        });
        
        signals.push(signal);
      }
    }
  } catch (err) {
    logger.error('OI divergence scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * SCAN TYPE 2: TVL Lag
 * Accelerating TVL growth but token price lagging
 * Indicates: Undervalued protocol, potential catch-up trade
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
      
      // Check for TVL growth outpacing price
      const tvlGrowth7d = tvlData.tvlChange7d;
      const priceGrowth7d = priceData.priceChange7d || 0;
      const divergence = tvlGrowth7d - priceGrowth7d;
      
      // Significant divergence: TVL growing >5% more than price
      // Also check acceleration (TVL growth accelerating)
      const isAccelerating = tvlData.tvlAcceleration > 2; // Accelerating by >2%
      const hasDivergence = divergence > 8;
      
      if (hasDivergence && tvlGrowth7d > 5) {
        // Calculate TVL per token metric
        const tvlPerMcap = tvlData.currentTvl / priceData.marketCap;
        
        const signal = formatSignal({
          signalType: 'TVL_LAG',
          asset: `${protocol.name} (${priceData.symbol})`,
          marketContext: `${protocol.name} TVL: $${formatNumber(tvlData.currentTvl)}. 7d TVL change: +${tvlGrowth7d.toFixed(2)}%. Token price 7d: ${priceGrowth7d > 0 ? '+' : ''}${priceGrowth7d.toFixed(2)}%. TVL/MCap ratio: ${tvlPerMcap.toFixed(2)}x.`,
          observedAnomaly: `TVL growth (+${tvlGrowth7d.toFixed(2)}%) significantly outpacing token appreciation (${priceGrowth7d.toFixed(2)}%). Divergence: ${divergence.toFixed(2)}%. ${isAccelerating ? 'TVL growth is ACCELERATING.' : ''}`,
          whyMatters: `Capital is flowing into protocol but token price hasn't adjusted. This suggests: (1) LPs/yield farmers don't hold governance token, or (2) Market hasn't priced in growth. Protocol revenue/fees typically correlate with TVL over medium term.`,
          tradeExpression: `Long ${priceData.symbol} spot. Entry: current ($${priceData.price.toFixed(4)}). Target: ${(priceGrowth7d + divergence * 0.5).toFixed(1)}% catch-up move over 1-2 weeks.`,
          timeHorizon: '1-2 weeks',
          keyRisks: 'Mercenary TVL (incentivized, will leave), token inflation diluting value, smart contract risk, broader market downturn',
          invalidationLevel: `TVL drops >10% or price falls below 30d low ($${formatNumber(priceData.price * (1 + (priceData.priceChange30d || -15) / 100))})`,
          confidenceScore: calculateTVLLagConfidence(tvlData, priceData, divergence),
          rawData: {
            tvl: tvlData.currentTvl,
            tvlChange7d,
            tvlAcceleration: tvlData.tvlAcceleration,
            priceChange7d,
            divergence,
            tvlPerMcap
          }
        });
        
        signals.push(signal);
      }
    }
  } catch (err) {
    logger.error('TVL lag scan failed', { error: err.message });
  }
  
  return signals;
}

/**
 * SCAN TYPE 3: Funding Rate Divergence
 * Cross-exchange funding rate anomalies
 * Indicates: Arbitrage opportunity, crowded positioning
 */
async function scanFundingDivergence() {
  logger.info('Scanning for funding divergence...');
  const signals = [];
  
  try {
    const tokenIds = SCAN_ASSETS.slice(0, 4).map(a => a.id); // Top 4 liquid assets
    const marketData = await fetchMarketData(tokenIds);
    
    for (const asset of SCAN_ASSETS.slice(0, 4)) {
      const price = marketData[asset.id];
      if (!price) continue;
      
      const fundingEstimate = estimateFundingSentiment(price);
      if (!fundingEstimate) continue;
      
      // Check for extreme sentiment
      if (fundingEstimate.sentiment !== 'neutral') {
        const isCrowdedLong = fundingEstimate.sentiment === 'crowded_long';
        
        // Additional confirmation: price near recent high/low
        const pricePosition = (price.price - price.low24h) / (price.high24h - price.low24h);
        const atExtreme = isCrowdedLong ? pricePosition > 0.85 : pricePosition < 0.15;
        
        if (atExtreme) {
          const signal = formatSignal({
            signalType: 'FUNDING_DIVERGENCE',
            asset: asset.symbol,
            marketContext: `${asset.symbol} at $${formatNumber(price.price)}. 24h range: $${formatNumber(price.low24h)} - $${formatNumber(price.high24h)}. Currently at ${(pricePosition * 100).toFixed(0)}% of range.`,
            observedAnomaly: `${isCrowdedLong ? 'Crowded long' : 'Crowded short'} positioning detected. High volume (${((price.volume24h / price.marketCap) * 100).toFixed(2)}% of MCap) with price ${isCrowdedLong ? 'near highs' : 'near lows'}. This often precedes mean reversion.`,
            whyMatters: `When positioning gets one-sided, funding costs increase for the crowded side. This creates: (1) Pressure to close positions, (2) Arbitrage incentive for market makers, (3) Squeeze risk if price moves against crowd.`,
            tradeExpression: isCrowdedLong 
              ? `Fade longs: Short ${asset.symbol} with tight stop above 24h high. Target: return to 24h VWAP (~$${formatNumber((price.high24h + price.low24h) / 2)})` 
              : `Fade shorts: Long ${asset.symbol} with stop below 24h low. Target: return to 24h VWAP (~$${formatNumber((price.high24h + price.low24h) / 2)})`,
            timeHorizon: '4-24 hours',
            keyRisks: 'Trend continuation invalidates thesis, news catalyst, exchange-specific dynamics',
            invalidationLevel: isCrowdedLong 
              ? `New 24h high above $${formatNumber(price.high24h * 1.01)}` 
              : `New 24h low below $${formatNumber(price.low24h * 0.99)}`,
            confidenceScore: Math.min(60, fundingEstimate.confidence + (atExtreme ? 15 : 0)),
            rawData: {
              price: price.price,
              high24h: price.high24h,
              low24h: price.low24h,
              pricePosition,
              fundingEstimate: fundingEstimate.value,
              sentiment: fundingEstimate.sentiment
            }
          });
          
          signals.push(signal);
        }
      }
    }
  } catch (err) {
    logger.error('Funding divergence scan failed', { error: err.message });
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
      minConfidence: 40,
      maxSignals: 10,
      ...config
    };
  }
  
  /**
   * Run all scans and return ranked signals
   */
  async scan() {
    logger.info('Starting alpha scan...');
    const startTime = Date.now();
    
    const allSignals = [];
    
    // Run scans in parallel
    const [oiSignals, tvlSignals, fundingSignals] = await Promise.all([
      scanOIDivergence(),
      scanTVLLag(),
      scanFundingDivergence()
    ]);
    
    allSignals.push(...oiSignals, ...tvlSignals, ...fundingSignals);
    
    // Filter and rank
    const filtered = allSignals
      .filter(s => s.confidenceScore >= this.config.minConfidence)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, this.config.maxSignals);
    
    logger.info(`Scan complete. Found ${filtered.length} actionable signals.`, {
      total: allSignals.length,
      filtered: filtered.length,
      durationMs: Date.now() - startTime
    });
    
    return {
      signals: filtered,
      summary: this.generateSummary(filtered),
      metadata: {
        scannedAssets: SCAN_ASSETS.length,
        scannedProtocols: SCAN_PROTOCOLS.length,
        timestamp: new Date().toISOString(),
        executionTimeMs: Date.now() - startTime
      }
    };
  }
  
  /**
   * Run specific scan type
   */
  async scanType(type) {
    switch (type) {
      case 'oi_divergence':
        return await scanOIDivergence();
      case 'tvl_lag':
        return await scanTVLLag();
      case 'funding_divergence':
        return await scanFundingDivergence();
      default:
        return [];
    }
  }
  
  generateSummary(signals) {
    if (signals.length === 0) {
      return 'No actionable signals detected. Markets appear range-bound with no significant anomalies.';
    }
    
    const byType = signals.reduce((acc, s) => {
      acc[s.signalType] = (acc[s.signalType] || 0) + 1;
      return acc;
    }, {});
    
    const topSignal = signals[0];
    const typeBreakdown = Object.entries(byType)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    
    return `Found ${signals.length} signals. Top: ${topSignal.asset} (${topSignal.signalType}, ${topSignal.confidenceScore}% confidence). Breakdown: ${typeBreakdown}`;
  }
}

module.exports = {
  AlphaScanner,
  scanOIDivergence,
  scanTVLLag,
  scanFundingDivergence,
  formatSignal,
  SCAN_ASSETS,
  SCAN_PROTOCOLS
};
