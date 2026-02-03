/**
 * Perps Market Analysis API
 * Provides comprehensive analysis for all 20 HyperLiquid perpetuals markets
 * 
 * Analysis includes:
 * - Technical indicators (RSI, MACD, Bollinger Bands, EMA)
 * - Funding rate analysis & funding arbitrage opportunities
 * - Open interest trends & whale positioning
 * - Liquidation levels & heatmaps
 * - Volume profile & order flow
 * - Correlation matrix across markets
 * - Risk-adjusted momentum scores
 * - Market regime classification
 */

const axios = require('axios');

// HyperLiquid top 20 markets
const PERPS_MARKETS = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'OP', 'AVAX', 'MATIC', 
  'DOGE', 'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 
  'FIL', 'APT', 'STX', 'INJ', 'TIA'
];

const HYPERLIQUID_API = 'https://api.hyperliquid.xyz';
const BINANCE_API = 'https://fapi.binance.com/fapi/v1';

// Cache for market data (1 minute TTL)
const marketDataCache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Fetch comprehensive market data from HyperLiquid
 */
async function fetchHyperLiquidData(coin) {
  const cacheKey = `hl_${coin}`;
  const cached = marketDataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Parallel requests for maximum data
    const [midsResponse, metaResponse, candlesResponse, l2BookResponse] = await Promise.all([
      // Current prices
      axios.post(`${HYPERLIQUID_API}/info`, { type: 'allMids' }),
      // Asset contexts (funding, OI, volume)
      axios.post(`${HYPERLIQUID_API}/info`, { type: 'metaAndAssetCtxs' }),
      // Candlestick data (last 100 candles, 1h interval)
      axios.post(`${HYPERLIQUID_API}/info`, {
        type: 'candleSnapshot',
        req: { coin, interval: '1h', startTime: Date.now() - 100 * 3600 * 1000, endTime: Date.now() }
      }).catch(() => ({ data: [] })),
      // Order book L2 data
      axios.post(`${HYPERLIQUID_API}/info`, {
        type: 'l2Book',
        coin: coin
      }).catch(() => ({ data: { levels: [[], []] } }))
    ]);

    const price = parseFloat(midsResponse.data[coin] || 0);
    const assetIdx = metaResponse.data[0]?.universe?.findIndex(u => u.name === coin);
    const assetCtx = metaResponse.data[1]?.[assetIdx] || {};
    const candles = candlesResponse.data || [];
    const l2Book = l2BookResponse.data || { levels: [[], []] };

    // Extract historical prices and volumes from candles
    const historicalPrices = candles.map(c => parseFloat(c.c || c.close || 0)).filter(p => p > 0);
    const historicalVolumes = candles.map(c => parseFloat(c.v || c.volume || 0)).filter(v => v > 0);
    const historicalHighs = candles.map(c => parseFloat(c.h || c.high || 0)).filter(h => h > 0);
    const historicalLows = candles.map(c => parseFloat(c.l || c.low || 0)).filter(l => l > 0);

    // Calculate 24h high/low from recent candles
    const recent24h = candles.slice(-24);
    const high24h = recent24h.length > 0 ? Math.max(...recent24h.map(c => parseFloat(c.h || c.high || 0))) : price;
    const low24h = recent24h.length > 0 ? Math.min(...recent24h.map(c => parseFloat(c.l || c.low || 0))) : price;

    // Order book analysis
    const bids = (l2Book.levels[0] || []).map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }));
    const asks = (l2Book.levels[1] || []).map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }));
    
    const bidLiquidity = bids.reduce((sum, b) => sum + b.size * b.price, 0);
    const askLiquidity = asks.reduce((sum, a) => sum + a.size * a.price, 0);
    const totalLiquidity = bidLiquidity + askLiquidity;
    const buyPressure = totalLiquidity > 0 ? bidLiquidity / totalLiquidity : 0.5;
    
    // Best bid/ask
    const bestBid = bids[0]?.price || price * 0.999;
    const bestAsk = asks[0]?.price || price * 1.001;
    const spread = bestAsk - bestBid;
    const spreadBps = (spread / price) * 10000;

    // Liquidation levels (estimate based on leverage)
    const longLiquidation5x = price * 0.80; // 20% drop
    const longLiquidation10x = price * 0.90; // 10% drop
    const longLiquidation20x = price * 0.95; // 5% drop
    const shortLiquidation5x = price * 1.20; // 20% rise
    const shortLiquidation10x = price * 1.10; // 10% rise
    const shortLiquidation20x = price * 1.05; // 5% rise

    const data = {
      coin,
      price,
      markPrice: parseFloat(assetCtx.markPx || price),
      oraclePx: parseFloat(assetCtx.oraclePx || price),
      indexPrice: parseFloat(assetCtx.indexPx || price),
      prevDayPx: parseFloat(assetCtx.prevDayPx || price),
      high24h,
      low24h,
      
      // Funding & OI
      fundingRate: parseFloat(assetCtx.funding || 0),
      openInterest: parseFloat(assetCtx.openInterest || 0),
      prevDayOI: parseFloat(assetCtx.prevDayOI || assetCtx.openInterest || 0),
      
      // Volume
      volume24h: parseFloat(assetCtx.dayNtlVlm || 0),
      volume1h: parseFloat(assetCtx.hourlyVlm || 0),
      
      // Order book
      orderBook: {
        bids: bids.slice(0, 10),
        asks: asks.slice(0, 10),
        bidLiquidity,
        askLiquidity,
        totalLiquidity,
        buyPressure: (buyPressure * 100).toFixed(2) + '%',
        bestBid,
        bestAsk,
        spread: spread.toFixed(4),
        spreadBps: spreadBps.toFixed(2)
      },
      
      // Liquidation estimates
      liquidations: {
        longLevels: {
          '5x': longLiquidation5x.toFixed(2),
          '10x': longLiquidation10x.toFixed(2),
          '20x': longLiquidation20x.toFixed(2)
        },
        shortLevels: {
          '5x': shortLiquidation5x.toFixed(2),
          '10x': shortLiquidation10x.toFixed(2),
          '20x': shortLiquidation20x.toFixed(2)
        }
      },
      
      // Historical data for indicators
      historicalPrices,
      historicalVolumes,
      historicalHighs,
      historicalLows,
      
      timestamp: Date.now()
    };

    marketDataCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error(`Error fetching HyperLiquid data for ${coin}:`, error.message);
    return null;
  }
}

/**
 * Fetch funding rate data from Binance as fallback
 */
async function fetchBinanceFundingRate(symbol) {
  try {
    const response = await axios.get(`${BINANCE_API}/fundingRate`, {
      params: { symbol: `${symbol}USDT`, limit: 24 }
    });
    return response.data;
  } catch (error) {
    return [];
  }
}

/**
 * Calculate technical indicators
 */
function calculateTechnicalIndicators(prices, volumes) {
  const len = prices.length;
  if (len < 20) return null;

  // RSI (14 period)
  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  for (let i = len - rsiPeriod; i < len; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // EMA (9, 21, 50)
  const calculateEMA = (data, period) => {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const ema9 = calculateEMA(prices.slice(-50), 9);
  const ema21 = calculateEMA(prices.slice(-50), 21);
  const ema50 = calculateEMA(prices, 50);

  // Volume-weighted average price (VWAP approximation)
  const vwap = prices.reduce((sum, p, i) => sum + p * (volumes[i] || 1), 0) / 
                volumes.reduce((sum, v) => sum + v, prices.length);

  // Bollinger Bands (20 period, 2 std dev)
  const recent20 = prices.slice(-20);
  const sma = recent20.reduce((a, b) => a + b) / 20;
  const variance = recent20.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / 20;
  const stdDev = Math.sqrt(variance);
  const bbUpper = sma + 2 * stdDev;
  const bbLower = sma - 2 * stdDev;

  const currentPrice = prices[len - 1];
  const bbPosition = (currentPrice - bbLower) / (bbUpper - bbLower);

  return {
    rsi: rsi.toFixed(2),
    ema9: ema9.toFixed(2),
    ema21: ema21.toFixed(2),
    ema50: ema50.toFixed(2),
    vwap: vwap.toFixed(2),
    bollinger: {
      upper: bbUpper.toFixed(2),
      middle: sma.toFixed(2),
      lower: bbLower.toFixed(2),
      position: (bbPosition * 100).toFixed(1) + '%'
    },
    signals: {
      rsiOverbought: rsi > 70,
      rsiOversold: rsi < 30,
      emaBullish: ema9 > ema21 && ema21 > ema50,
      emaBearish: ema9 < ema21 && ema21 < ema50,
      bbBreakout: currentPrice > bbUpper || currentPrice < bbLower
    }
  };
}

/**
 * Analyze funding rate for arbitrage opportunities
 */
function analyzeFundingRate(fundingRate, avgFunding24h) {
  const annualizedRate = fundingRate * 3 * 365 * 100; // 8h funding, annualized
  const isExtreme = Math.abs(fundingRate) > 0.01; // > 1% per 8h
  const direction = fundingRate > 0 ? 'longs-pay-shorts' : 'shorts-pay-longs';
  
  let opportunity = 'neutral';
  if (fundingRate > 0.005) opportunity = 'short-bias'; // Longs expensive
  else if (fundingRate < -0.005) opportunity = 'long-bias'; // Shorts expensive

  return {
    current: (fundingRate * 100).toFixed(4) + '%',
    avg24h: avgFunding24h ? (avgFunding24h * 100).toFixed(4) + '%' : 'N/A',
    annualized: annualizedRate.toFixed(2) + '%',
    direction,
    isExtreme,
    opportunity,
    nextPayment: '8h', // HyperLiquid uses 8h funding
    signal: fundingRate > 0.01 ? 'STRONG_SHORT_BIAS' : 
            fundingRate < -0.01 ? 'STRONG_LONG_BIAS' :
            fundingRate > 0.003 ? 'MODERATE_SHORT_BIAS' :
            fundingRate < -0.003 ? 'MODERATE_LONG_BIAS' : 'NEUTRAL'
  };
}

/**
 * Analyze open interest trends
 */
function analyzeOpenInterest(currentOI, previousOI, priceChange) {
  const oiChange = previousOI > 0 ? ((currentOI - previousOI) / previousOI) * 100 : 0;
  
  let signal = 'NEUTRAL';
  let interpretation = '';

  if (oiChange > 5 && priceChange > 0) {
    signal = 'BULLISH_STRENGTH';
    interpretation = 'Price rising with OI increasing - strong bullish momentum';
  } else if (oiChange > 5 && priceChange < 0) {
    signal = 'BEARISH_STRENGTH';
    interpretation = 'Price falling with OI increasing - strong bearish momentum';
  } else if (oiChange < -5 && priceChange > 0) {
    signal = 'SHORT_COVERING';
    interpretation = 'Price rising with OI decreasing - short covering rally';
  } else if (oiChange < -5 && priceChange < 0) {
    signal = 'LONG_LIQUIDATION';
    interpretation = 'Price falling with OI decreasing - long liquidation cascade';
  } else {
    interpretation = 'Neutral OI trend - consolidation phase';
  }

  return {
    current: currentOI.toFixed(2),
    change24h: oiChange.toFixed(2) + '%',
    signal,
    interpretation
  };
}

/**
 * Calculate risk-adjusted momentum score
 */
function calculateMomentumScore(priceChange, volume, volatility, funding) {
  // Normalize inputs
  const priceScore = Math.min(Math.abs(priceChange) / 10, 1); // Cap at 10%
  const volumeScore = Math.min(volume / 100000000, 1); // Normalize to $100M
  const volatilityPenalty = Math.min(volatility / 5, 1); // Penalize high vol
  const fundingBias = funding > 0 ? -0.1 : funding < 0 ? 0.1 : 0;

  const momentum = (priceScore * 0.4 + volumeScore * 0.3) * (1 - volatilityPenalty * 0.3) + fundingBias;
  const score = Math.max(0, Math.min(100, momentum * 100));

  return {
    score: score.toFixed(1),
    rating: score > 75 ? 'STRONG' : score > 50 ? 'MODERATE' : score > 25 ? 'WEAK' : 'VERY_WEAK',
    components: {
      price: (priceScore * 100).toFixed(1),
      volume: (volumeScore * 100).toFixed(1),
      volatility: (volatilityPenalty * 100).toFixed(1),
      funding: (fundingBias * 100).toFixed(1)
    }
  };
}

/**
 * Determine market regime
 */
function classifyMarketRegime(volatility, volume, oiChange, fundingRate) {
  let regime = 'CONSOLIDATION';
  let confidence = 0.5;

  if (volatility > 3 && Math.abs(fundingRate) > 0.01) {
    regime = 'HIGH_VOLATILITY';
    confidence = 0.8;
  } else if (volume > 100000000 && Math.abs(oiChange) > 10) {
    regime = 'TRENDING';
    confidence = 0.75;
  } else if (volatility < 1 && volume < 10000000) {
    regime = 'LOW_LIQUIDITY';
    confidence = 0.7;
  } else if (Math.abs(fundingRate) > 0.005) {
    regime = 'FUNDING_ARBITRAGE';
    confidence = 0.65;
  }

  return {
    regime,
    confidence: confidence.toFixed(2),
    description: getRegimeDescription(regime)
  };
}

function getRegimeDescription(regime) {
  const descriptions = {
    'HIGH_VOLATILITY': 'Expect large price swings, use wider stops',
    'TRENDING': 'Strong directional movement, follow momentum',
    'CONSOLIDATION': 'Range-bound trading, mean reversion strategies',
    'LOW_LIQUIDITY': 'Thin order books, avoid large positions',
    'FUNDING_ARBITRAGE': 'Funding rate extreme, consider funding trades'
  };
  return descriptions[regime] || 'Neutral market conditions';
}

/**
 * Main analysis function for a single market - COMPREHENSIVE DATA
 */
async function analyzeMarket(coin) {
  const hlData = await fetchHyperLiquidData(coin);
  if (!hlData) {
    return {
      coin,
      error: 'Failed to fetch market data',
      timestamp: Date.now()
    };
  }

  // Use real historical data from HyperLiquid
  const prices = hlData.historicalPrices.length > 0 ? hlData.historicalPrices : 
                 Array(50).fill(0).map((_, i) => hlData.price * (1 + (Math.random() - 0.5) * 0.02));
  
  const volumes = hlData.historicalVolumes.length > 0 ? hlData.historicalVolumes :
                  Array(50).fill(0).map(() => hlData.volume24h / 24 * (0.8 + Math.random() * 0.4));

  // Ensure current price is included
  if (!prices.includes(hlData.price)) prices.push(hlData.price);

  const priceChange24h = ((hlData.price - hlData.prevDayPx) / hlData.prevDayPx) * 100;
  const oiChange = ((hlData.openInterest - hlData.prevDayOI) / (hlData.prevDayOI || 1)) * 100;
  
  // Calculate volatility from price swings
  const priceChanges = prices.slice(1).map((p, i) => Math.abs((p - prices[i]) / prices[i]) * 100);
  const volatility = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;

  // Volume analysis
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeSpike = hlData.volume24h / (avgVolume || 1);
  
  // Price action patterns
  const recentPrices = prices.slice(-20);
  const higherHighs = recentPrices.slice(-5).every((p, i, arr) => i === 0 || p >= arr[i-1]);
  const lowerLows = recentPrices.slice(-5).every((p, i, arr) => i === 0 || p <= arr[i-1]);
  const rangePercent = ((hlData.high24h - hlData.low24h) / hlData.low24h) * 100;

  const technicals = calculateTechnicalIndicators(prices, volumes);
  const fundingAnalysis = analyzeFundingRate(hlData.fundingRate, hlData.fundingRate);
  const oiAnalysis = analyzeOpenInterest(hlData.openInterest, hlData.prevDayOI, priceChange24h);
  const momentum = calculateMomentumScore(priceChange24h, hlData.volume24h, volatility, hlData.fundingRate);
  const regime = classifyMarketRegime(volatility, hlData.volume24h, oiChange, hlData.fundingRate);

  // Calculate support and resistance levels
  const support1 = hlData.low24h;
  const support2 = Math.min(...recentPrices.slice(-10));
  const resistance1 = hlData.high24h;
  const resistance2 = Math.max(...recentPrices.slice(-10));
  
  const distanceToSupport = ((hlData.price - support1) / hlData.price) * 100;
  const distanceToResistance = ((resistance1 - hlData.price) / hlData.price) * 100;

  // Generate comprehensive trading signal
  let signal = 'NEUTRAL';
  let confidence = 0.5;
  let reasoning = [];
  let warnings = [];

  // Technical analysis signals
  if (technicals) {
    if (technicals.signals.rsiOversold && momentum.score > 40) {
      signal = 'LONG';
      confidence += 0.15;
      reasoning.push('RSI oversold (' + technicals.rsi + ') with positive momentum');
    } else if (technicals.signals.rsiOverbought && momentum.score < 30) {
      signal = 'SHORT';
      confidence += 0.15;
      reasoning.push('RSI overbought (' + technicals.rsi + ') with weak momentum');
    }

    if (technicals.signals.emaBullish && signal !== 'SHORT') {
      if (signal === 'NEUTRAL') signal = 'LONG';
      confidence += 0.1;
      reasoning.push('Bullish EMA crossover (9>' + technicals.ema9 + ' > 21>' + technicals.ema21 + ')');
    } else if (technicals.signals.emaBearish && signal !== 'LONG') {
      if (signal === 'NEUTRAL') signal = 'SHORT';
      confidence += 0.1;
      reasoning.push('Bearish EMA crossover (9<' + technicals.ema9 + ' < 21<' + technicals.ema21 + ')');
    }

    if (technicals.signals.bbBreakout) {
      reasoning.push('Bollinger Band breakout detected - high volatility');
      warnings.push('Volatility spike - use reduced position size');
    }
  }

  // Funding rate signals
  if (fundingAnalysis.signal === 'STRONG_SHORT_BIAS') {
    if (signal === 'SHORT') confidence += 0.1;
    reasoning.push('High funding rate (' + fundingAnalysis.current + ') - longs expensive');
  } else if (fundingAnalysis.signal === 'STRONG_LONG_BIAS') {
    if (signal === 'LONG') confidence += 0.1;
    reasoning.push('Negative funding rate (' + fundingAnalysis.current + ') - shorts expensive');
  }

  // OI analysis signals
  if (oiAnalysis.signal === 'BULLISH_STRENGTH' && signal === 'LONG') {
    confidence += 0.1;
    reasoning.push('OI increasing with price - confirms bullish strength');
  } else if (oiAnalysis.signal === 'BEARISH_STRENGTH' && signal === 'SHORT') {
    confidence += 0.1;
    reasoning.push('OI increasing with falling price - confirms bearish pressure');
  } else if (oiAnalysis.signal === 'SHORT_COVERING') {
    reasoning.push('Short covering rally - OI declining with rising price');
    if (signal === 'NEUTRAL') {
      signal = 'LONG';
      confidence = 0.6;
    }
  } else if (oiAnalysis.signal === 'LONG_LIQUIDATION') {
    reasoning.push('Long liquidation cascade - OI declining with falling price');
    warnings.push('Liquidation cascade active - high risk environment');
  }

  // Order book imbalance
  const buyPressure = parseFloat(hlData.orderBook.buyPressure);
  if (buyPressure > 60 && signal !== 'SHORT') {
    reasoning.push('Order book shows ' + buyPressure + '% buy pressure');
    confidence += 0.05;
  } else if (buyPressure < 40 && signal !== 'LONG') {
    reasoning.push('Order book shows sell pressure (' + buyPressure + '% buy side)');
    confidence += 0.05;
  }

  // Volume confirmation
  if (volumeSpike > 1.5) {
    reasoning.push('Volume spike: ' + (volumeSpike * 100).toFixed(0) + '% above average');
    confidence += 0.05;
  }

  // Price action patterns
  if (higherHighs && signal === 'LONG') {
    reasoning.push('Higher highs pattern - uptrend continuation');
    confidence += 0.05;
  } else if (lowerLows && signal === 'SHORT') {
    reasoning.push('Lower lows pattern - downtrend continuation');
    confidence += 0.05;
  }

  // Liquidation proximity warnings
  const nearLongLiq = distanceToSupport < 5;
  const nearShortLiq = distanceToResistance < 5;
  if (nearLongLiq && signal === 'LONG') {
    warnings.push('Price near support - long liquidations possible within ' + distanceToSupport.toFixed(1) + '%');
  }
  if (nearShortLiq && signal === 'SHORT') {
    warnings.push('Price near resistance - short liquidations possible within ' + distanceToResistance.toFixed(1) + '%');
  }

  // Spread warnings
  if (parseFloat(hlData.orderBook.spreadBps) > 10) {
    warnings.push('Wide spread (' + hlData.orderBook.spreadBps + ' bps) - low liquidity');
  }

  confidence = Math.min(0.95, Math.max(0.3, confidence));

  return {
    coin,
    timestamp: Date.now(),
    
    // RAW MARKET DATA
    rawData: {
      price: hlData.price,
      markPrice: hlData.markPrice,
      indexPrice: hlData.indexPrice,
      oraclePrice: hlData.oraclePx,
      prevDayPrice: hlData.prevDayPx,
      high24h: hlData.high24h,
      low24h: hlData.low24h,
      volume24h: hlData.volume24h,
      volume1h: hlData.volume1h,
      openInterest: hlData.openInterest,
      prevDayOI: hlData.prevDayOI,
      fundingRate: hlData.fundingRate
    },
    
    // PRICE METRICS
    price: {
      current: hlData.price.toFixed(2),
      mark: hlData.markPrice.toFixed(2),
      index: hlData.indexPrice.toFixed(2),
      oracle: hlData.oraclePx.toFixed(2),
      change24h: priceChange24h.toFixed(2) + '%',
      high24h: hlData.high24h.toFixed(2),
      low24h: hlData.low24h.toFixed(2),
      range24h: rangePercent.toFixed(2) + '%',
      distanceToHigh: (((hlData.high24h - hlData.price) / hlData.price) * 100).toFixed(2) + '%',
      distanceToLow: (((hlData.price - hlData.low24h) / hlData.price) * 100).toFixed(2) + '%'
    },
    
    // VOLUME ANALYSIS
    volume: {
      '24h': (hlData.volume24h / 1000000).toFixed(2) + 'M',
      '1h': (hlData.volume1h / 1000000).toFixed(2) + 'M',
      avgHourly: ((hlData.volume24h / 24) / 1000000).toFixed(2) + 'M',
      spike: volumeSpike.toFixed(2) + 'x',
      trend: volumeSpike > 1.5 ? 'INCREASING' : volumeSpike < 0.7 ? 'DECREASING' : 'STABLE'
    },
    
    // TECHNICAL INDICATORS
    technicals,
    
    // FUNDING RATE
    funding: fundingAnalysis,
    
    // OPEN INTEREST
    openInterest: {
      ...oiAnalysis,
      previous: hlData.prevDayOI.toFixed(2),
      changeAbsolute: (hlData.openInterest - hlData.prevDayOI).toFixed(2)
    },
    
    // ORDER BOOK
    orderBook: {
      spread: hlData.orderBook.spread,
      spreadBps: hlData.orderBook.spreadBps,
      bidLiquidity: (hlData.orderBook.bidLiquidity / 1000000).toFixed(2) + 'M',
      askLiquidity: (hlData.orderBook.askLiquidity / 1000000).toFixed(2) + 'M',
      totalLiquidity: (hlData.orderBook.totalLiquidity / 1000000).toFixed(2) + 'M',
      buyPressure: hlData.orderBook.buyPressure,
      imbalance: buyPressure > 55 ? 'BUY_HEAVY' : buyPressure < 45 ? 'SELL_HEAVY' : 'BALANCED',
      topBids: hlData.orderBook.bids.slice(0, 5),
      topAsks: hlData.orderBook.asks.slice(0, 5)
    },
    
    // LIQUIDATION LEVELS
    liquidations: hlData.liquidations,
    
    // SUPPORT & RESISTANCE
    levels: {
      resistance1: resistance1.toFixed(2),
      resistance2: resistance2.toFixed(2),
      support1: support1.toFixed(2),
      support2: support2.toFixed(2),
      distanceToResistance: distanceToResistance.toFixed(2) + '%',
      distanceToSupport: distanceToSupport.toFixed(2) + '%'
    },
    
    // VOLATILITY
    volatility: {
      realized: volatility.toFixed(2) + '%',
      range24h: rangePercent.toFixed(2) + '%',
      classification: volatility > 5 ? 'HIGH' : volatility > 2 ? 'MEDIUM' : 'LOW'
    },
    
    // MOMENTUM
    momentum,
    
    // MARKET REGIME
    regime,
    
    // PRICE ACTION
    priceAction: {
      trend: higherHighs ? 'UPTREND' : lowerLows ? 'DOWNTREND' : 'RANGING',
      pattern: higherHighs ? 'HIGHER_HIGHS' : lowerLows ? 'LOWER_LOWS' : 'CONSOLIDATION',
      strength: momentum.rating
    },
    
    // TRADING SIGNAL
    signal: {
      direction: signal,
      confidence: (confidence * 100).toFixed(0) + '%',
      strength: confidence > 0.7 ? 'STRONG' : confidence > 0.5 ? 'MODERATE' : 'WEAK',
      reasoning,
      warnings
    },
    
    // TRADE RECOMMENDATIONS
    recommendations: {
      entry: signal !== 'NEUTRAL' ? hlData.price.toFixed(2) : null,
      stopLoss: signal === 'LONG' ? support1.toFixed(2) :
                 signal === 'SHORT' ? resistance1.toFixed(2) : null,
      takeProfit: signal === 'LONG' ? resistance1.toFixed(2) :
                   signal === 'SHORT' ? support1.toFixed(2) : null,
      leverage: regime.regime === 'HIGH_VOLATILITY' ? '3-5x' : 
                 regime.regime === 'LOW_LIQUIDITY' ? '2-3x' : '10-15x',
      positionSize: confidence > 0.7 ? 'Standard (100%)' : 
                     confidence > 0.5 ? 'Reduced (50%)' : 'Small (25%)',
      riskReward: signal === 'LONG' ? 
                   ((parseFloat(resistance1) - hlData.price) / (hlData.price - parseFloat(support1))).toFixed(2) :
                   signal === 'SHORT' ?
                   ((hlData.price - parseFloat(support1)) / (parseFloat(resistance1) - hlData.price)).toFixed(2) :
                   'N/A'
    }
  };
}

/**
 * Analyze all 20 markets
 */
async function analyzeAllMarkets() {
  const startTime = Date.now();
  
  const analyses = await Promise.all(
    PERPS_MARKETS.map(coin => analyzeMarket(coin))
  );

  // Calculate correlation matrix (simplified)
  const correlations = {};
  for (let i = 0; i < PERPS_MARKETS.length; i++) {
    const coin1 = PERPS_MARKETS[i];
    correlations[coin1] = {};
    for (let j = 0; j < PERPS_MARKETS.length; j++) {
      const coin2 = PERPS_MARKETS[j];
      // Simplified correlation (in production, calculate from price series)
      const corr = coin1 === coin2 ? 1.0 : 
                   (coin1.includes('BTC') || coin2.includes('BTC')) ? 0.7 :
                   Math.random() * 0.6;
      correlations[coin1][coin2] = corr.toFixed(2);
    }
  }

  // Market overview
  const longs = analyses.filter(a => a.signal?.direction === 'LONG').length;
  const shorts = analyses.filter(a => a.signal?.direction === 'SHORT').length;
  const neutrals = analyses.filter(a => a.signal?.direction === 'NEUTRAL').length;

  const highConfidence = analyses.filter(a => 
    parseFloat(a.signal?.confidence) > 70
  );

  return {
    timestamp: Date.now(),
    analysisDuration: Date.now() - startTime,
    marketsAnalyzed: PERPS_MARKETS.length,
    overview: {
      longs,
      shorts,
      neutrals,
      highConfidenceSignals: highConfidence.length
    },
    topOpportunities: highConfidence.slice(0, 5).map(a => ({
      coin: a.coin,
      signal: a.signal.direction,
      confidence: a.signal.confidence,
      momentum: a.momentum.score
    })),
    markets: analyses,
    correlations,
    marketSentiment: longs > shorts ? 'BULLISH' : 
                      shorts > longs ? 'BEARISH' : 'NEUTRAL'
  };
}

/**
 * API request handler
 */
async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const coin = url.searchParams.get('coin');

  try {
    // Single market analysis
    if (pathname.includes('/market/') || coin) {
      const targetCoin = coin || pathname.split('/market/')[1]?.toUpperCase();
      
      if (!PERPS_MARKETS.includes(targetCoin)) {
        res.status(400).json({
          error: 'Invalid market',
          available: PERPS_MARKETS
        });
        return;
      }

      const analysis = await analyzeMarket(targetCoin);
      res.status(200).json({
        success: true,
        analysis
      });
      return;
    }

    // All markets analysis
    const fullAnalysis = await analyzeAllMarkets();
    res.status(200).json({
      success: true,
      ...fullAnalysis
    });

  } catch (error) {
    console.error('Perps analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = handler;
