/**
 * Perps Intelligence API
 * Aggregates data from multiple sources for comprehensive trading analysis
 */

const axios = require('axios');

// API Configuration
const API_KEYS = {
  glassnode: process.env.GLASSNODE_API_KEY || '',
  messari: process.env.MESSARI_API_KEY || '',
  nansen: process.env.NANSEN_API_KEY || '',
  tokenTerminal: process.env.TOKEN_TERMINAL_API_KEY || '',
  coingecko: process.env.COINGECKO_API_KEY || ''
};

// Market symbol mappings
const SYMBOL_MAP = {
  'BTC': { glassnode: 'BTC', messari: 'bitcoin', coingecko: 'bitcoin', nansen: 'bitcoin' },
  'ETH': { glassnode: 'ETH', messari: 'ethereum', coingecko: 'ethereum', nansen: 'ethereum' },
  'SOL': { glassnode: 'SOL', messari: 'solana', coingecko: 'solana', nansen: 'solana' },
  'HYPE': { messari: 'hyperliquid', coingecko: 'hyperliquid' },
  'ARB': { messari: 'arbitrum', coingecko: 'arbitrum' },
  'OP': { messari: 'optimism', coingecko: 'optimism' },
  'AVAX': { messari: 'avalanche', coingecko: 'avalanche-2' },
  'MATIC': { messari: 'polygon', coingecko: 'matic-network' },
  'DOGE': { messari: 'dogecoin', coingecko: 'dogecoin' },
  'LINK': { messari: 'chainlink', coingecko: 'chainlink' }
};

/**
 * Fetch on-chain metrics from Glassnode
 */
async function getGlassnodeMetrics(market) {
  try {
    const symbol = SYMBOL_MAP[market]?.glassnode;
    if (!symbol) throw new Error('Symbol not supported by Glassnode');

    const metrics = {};

    // Exchange netflow (24h)
    try {
      const netflowRes = await axios.get(`https://api.glassnode.com/v1/metrics/transactions/transfers_volume_exchanges_net`, {
        params: {
          a: symbol,
          api_key: API_KEYS.glassnode,
          i: '24h',
          f: 'JSON'
        },
        timeout: 5000
      });
      const latest = netflowRes.data?.[netflowRes.data.length - 1];
      metrics.exchangeNetflow = latest?.v || 0;
    } catch (e) {
      console.error('Glassnode netflow error:', e.message);
      metrics.exchangeNetflow = null;
    }

    // Whale transactions
    try {
      const whaleRes = await axios.get(`https://api.glassnode.com/v1/metrics/transactions/count_greater_100k`, {
        params: {
          a: symbol,
          api_key: API_KEYS.glassnode,
          i: '24h',
          f: 'JSON'
        },
        timeout: 5000
      });
      const latest = whaleRes.data?.[whaleRes.data.length - 1];
      metrics.whaleTransactions = latest?.v || 0;
    } catch (e) {
      console.error('Glassnode whale tx error:', e.message);
      metrics.whaleTransactions = null;
    }

    // Active addresses
    try {
      const activeRes = await axios.get(`https://api.glassnode.com/v1/metrics/addresses/active_count`, {
        params: {
          a: symbol,
          api_key: API_KEYS.glassnode,
          i: '24h',
          f: 'JSON'
        },
        timeout: 5000
      });
      const latest = activeRes.data?.[activeRes.data.length - 1];
      metrics.activeAddresses = latest?.v || 0;
    } catch (e) {
      console.error('Glassnode active addresses error:', e.message);
      metrics.activeAddresses = null;
    }

    // MVRV Ratio
    try {
      const mvrvRes = await axios.get(`https://api.glassnode.com/v1/metrics/market/mvrv`, {
        params: {
          a: symbol,
          api_key: API_KEYS.glassnode,
          f: 'JSON'
        },
        timeout: 5000
      });
      const latest = mvrvRes.data?.[mvrvRes.data.length - 1];
      metrics.mvrvRatio = latest?.v || 0;
    } catch (e) {
      console.error('Glassnode MVRV error:', e.message);
      metrics.mvrvRatio = null;
    }

    // Realized Cap
    try {
      const rcapRes = await axios.get(`https://api.glassnode.com/v1/metrics/market/marketcap_realized_usd`, {
        params: {
          a: symbol,
          api_key: API_KEYS.glassnode,
          f: 'JSON'
        },
        timeout: 5000
      });
      const latest = rcapRes.data?.[rcapRes.data.length - 1];
      metrics.realizedCap = latest?.v ? (latest.v / 1e9).toFixed(2) : 0; // Convert to billions
    } catch (e) {
      console.error('Glassnode realized cap error:', e.message);
      metrics.realizedCap = null;
    }

    return metrics;
  } catch (error) {
    console.error('Glassnode API error:', error.message);
    return null;
  }
}

/**
 * Fetch market intelligence from Messari
 */
async function getMessariMetrics(market) {
  try {
    const symbol = SYMBOL_MAP[market]?.messari;
    if (!symbol) throw new Error('Symbol not supported by Messari');

    const headers = API_KEYS.messari ? { 'x-messari-api-key': API_KEYS.messari } : {};

    const response = await axios.get(`https://data.messari.io/api/v1/assets/${symbol}/metrics`, {
      headers,
      timeout: 5000
    });

    const data = response.data?.data;
    if (!data) throw new Error('No data from Messari');

    return {
      price: data.market_data?.price_usd || 0,
      marketCap: data.marketcap?.current_marketcap_usd || 0,
      volume24h: data.market_data?.volume_last_24_hours || 0,
      realVolume24h: data.market_data?.real_volume_last_24_hours || 0,
      percentChange24h: data.market_data?.percent_change_usd_last_24_hours || 0,
      percentChange7d: data.market_data?.percent_change_usd_last_7_days || 0,
      circulatingSupply: data.supply?.circulating || 0,
      maxSupply: data.supply?.max || 0
    };
  } catch (error) {
    console.error('Messari API error:', error.message);
    return null;
  }
}

/**
 * Fetch CoinGecko market data (free tier)
 */
async function getCoingeckoMetrics(market) {
  try {
    const symbol = SYMBOL_MAP[market]?.coingecko;
    if (!symbol) throw new Error('Symbol not supported by CoinGecko');

    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${symbol}`, {
      params: {
        localization: false,
        tickers: true,
        market_data: true,
        community_data: false,
        developer_data: false
      },
      headers: API_KEYS.coingecko ? { 'x-cg-pro-api-key': API_KEYS.coingecko } : {},
      timeout: 5000
    });

    const data = response.data;
    const marketData = data.market_data;

    return {
      price: marketData?.current_price?.usd || 0,
      marketCap: marketData?.market_cap?.usd || 0,
      volume24h: marketData?.total_volume?.usd || 0,
      high24h: marketData?.high_24h?.usd || 0,
      low24h: marketData?.low_24h?.usd || 0,
      priceChange24h: marketData?.price_change_percentage_24h || 0,
      priceChange7d: marketData?.price_change_percentage_7d || 0,
      priceChange30d: marketData?.price_change_percentage_30d || 0,
      circulatingSupply: marketData?.circulating_supply || 0,
      totalSupply: marketData?.total_supply || 0,
      ath: marketData?.ath?.usd || 0,
      athDate: marketData?.ath_date?.usd || null,
      atl: marketData?.atl?.usd || 0,
      atlDate: marketData?.atl_date?.usd || null
    };
  } catch (error) {
    console.error('CoinGecko API error:', error.message);
    return null;
  }
}

/**
 * Fetch HyperLiquid-specific data
 */
async function getHyperLiquidData(market) {
  try {
    // HyperLiquid Meta endpoint
    const metaRes = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'meta'
    }, { timeout: 5000 });

    const meta = metaRes.data?.universe?.find(u => u.name === market);
    if (!meta) throw new Error('Market not found on HyperLiquid');

    // Get all mids (current prices)
    const midsRes = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'allMids'
    }, { timeout: 5000 });

    const assetIndex = metaRes.data?.universe?.findIndex(u => u.name === market);
    const currentPrice = midsRes.data?.[assetIndex] ? parseFloat(midsRes.data[assetIndex]) : 0;

    // Get funding rate
    const fundingRes = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'metaAndAssetCtxs'
    }, { timeout: 5000 });

    const assetCtx = fundingRes.data?.[0]?.find(ctx => ctx.universe === assetIndex);
    const fundingRate = assetCtx?.funding ? parseFloat(assetCtx.funding) : 0;
    const openInterest = assetCtx?.openInterest ? parseFloat(assetCtx.openInterest) : 0;

    return {
      price: currentPrice,
      fundingRate: fundingRate,
      openInterest: openInterest,
      maxLeverage: meta.maxLeverage || 50,
      szDecimals: meta.szDecimals || 4
    };
  } catch (error) {
    console.error('HyperLiquid API error:', error.message);
    return null;
  }
}

/**
 * Calculate support and resistance levels using multiple methods
 */
function calculateSupportResistance(historicalData, currentPrice) {
  if (!historicalData || historicalData.length === 0) {
    return generateFallbackSRLevels(currentPrice);
  }

  const prices = historicalData.map(d => d.price).filter(p => p > 0);
  if (prices.length === 0) {
    return generateFallbackSRLevels(currentPrice);
  }

  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const range = high - low;

  // Fibonacci levels
  const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map(fib => {
    return low + (range * fib);
  });

  // Pivot points (classical)
  const pivot = (high + low + currentPrice) / 3;
  const r1 = (2 * pivot) - low;
  const r2 = pivot + range;
  const r3 = high + 2 * (pivot - low);
  const s1 = (2 * pivot) - high;
  const s2 = pivot - range;
  const s3 = low - 2 * (high - pivot);

  // Combine and filter by current price
  const resistance = [r1, r2, r3, ...fibLevels.filter(f => f > currentPrice)]
    .filter(r => r > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((price, i) => ({
      price,
      strength: i === 0 ? 'Weak' : i === 1 ? 'Medium' : 'Strong'
    }));

  const support = [s1, s2, s3, ...fibLevels.filter(f => f < currentPrice)]
    .filter(s => s < currentPrice && s > 0)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .map((price, i) => ({
      price,
      strength: i === 0 ? 'Weak' : i === 1 ? 'Medium' : 'Strong'
    }));

  return { resistance, support };
}

function generateFallbackSRLevels(currentPrice) {
  const volatility = currentPrice * 0.05;
  
  return {
    resistance: [
      { price: currentPrice + volatility, strength: 'Weak' },
      { price: currentPrice + volatility * 1.5, strength: 'Medium' },
      { price: currentPrice + volatility * 2, strength: 'Strong' }
    ],
    support: [
      { price: currentPrice - volatility, strength: 'Weak' },
      { price: currentPrice - volatility * 1.5, strength: 'Medium' },
      { price: currentPrice - volatility * 2, strength: 'Strong' }
    ]
  };
}

/**
 * Generate trading signal based on multiple indicators
 */
function generateTradingSignal(metrics) {
  const signals = [];
  let bullishScore = 0;
  let bearishScore = 0;

  // On-chain sentiment
  if (metrics.onchain?.exchangeNetflow) {
    if (metrics.onchain.exchangeNetflow < 0) {
      bullishScore += 2; // Outflows = bullish
      signals.push('Negative exchange netflow (bullish)');
    } else {
      bearishScore += 2; // Inflows = bearish
      signals.push('Positive exchange netflow (bearish)');
    }
  }

  // MVRV ratio
  if (metrics.onchain?.mvrvRatio) {
    if (metrics.onchain.mvrvRatio < 1) {
      bullishScore += 1; // Undervalued
      signals.push('MVRV below 1 (undervalued)');
    } else if (metrics.onchain.mvrvRatio > 3) {
      bearishScore += 1; // Overvalued
      signals.push('MVRV above 3 (overvalued)');
    }
  }

  // Funding rate
  if (metrics.hyperliquid?.fundingRate) {
    if (Math.abs(metrics.hyperliquid.fundingRate) < 0.01) {
      bullishScore += 1; // Neutral funding
      signals.push('Neutral funding rate');
    } else if (metrics.hyperliquid.fundingRate > 0.05) {
      bearishScore += 2; // High positive = overbought
      signals.push('High positive funding (overbought)');
    } else if (metrics.hyperliquid.fundingRate < -0.05) {
      bullishScore += 2; // High negative = oversold
      signals.push('High negative funding (oversold)');
    }
  }

  // Price momentum
  if (metrics.market?.priceChange24h) {
    if (metrics.market.priceChange24h > 5) {
      bullishScore += 1;
      signals.push('Strong 24h momentum');
    } else if (metrics.market.priceChange24h < -5) {
      bearishScore += 1;
      signals.push('Weak 24h momentum');
    }
  }

  const totalScore = bullishScore - bearishScore;
  let verdict = 'NEUTRAL';
  if (totalScore >= 3) verdict = 'BULLISH';
  else if (totalScore <= -3) verdict = 'BEARISH';

  return {
    verdict,
    bullishScore,
    bearishScore,
    signals,
    summary: generateSignalSummary(verdict, signals)
  };
}

function generateSignalSummary(verdict, signals) {
  const signalList = signals.slice(0, 3).join(', ');
  
  if (verdict === 'BULLISH') {
    return `Strong bullish signals detected: ${signalList}. Consider long positions with tight stops.`;
  } else if (verdict === 'BEARISH') {
    return `Bearish pressure building: ${signalList}. Consider reducing exposure or short setups.`;
  } else {
    return `Mixed signals across indicators: ${signalList}. Wait for clearer directional bias.`;
  }
}

/**
 * Main endpoint: Get comprehensive perps intelligence
 */
async function getPerpsIntelligence(market, timeframe = '1d') {
  try {
    console.log(`📊 Fetching perps intelligence for ${market}...`);

    // Fetch data from multiple sources in parallel
    const [onchain, market_messari, market_cg, hyperliquid] = await Promise.allSettled([
      getGlassnodeMetrics(market),
      getMessariMetrics(market),
      getCoingeckoMetrics(market),
      getHyperLiquidData(market)
    ]);

    const metrics = {
      onchain: onchain.status === 'fulfilled' ? onchain.value : null,
      market_messari: market_messari.status === 'fulfilled' ? market_messari.value : null,
      market: market_cg.status === 'fulfilled' ? market_cg.value : null,
      hyperliquid: hyperliquid.status === 'fulfilled' ? hyperliquid.value : null
    };

    // Get current price (fallback chain: HyperLiquid -> CoinGecko -> Messari)
    const currentPrice = metrics.hyperliquid?.price || 
                         metrics.market?.price || 
                         metrics.market_messari?.price || 
                         0;

    // Calculate S/R levels
    const srLevels = calculateSupportResistance([], currentPrice);

    // Generate trading signal
    const signal = generateTradingSignal(metrics);

    return {
      success: true,
      market,
      timeframe,
      timestamp: new Date().toISOString(),
      currentPrice,
      metrics,
      srLevels,
      signal,
      dataSources: {
        glassnode: metrics.onchain !== null,
        messari: metrics.market_messari !== null,
        coingecko: metrics.market !== null,
        hyperliquid: metrics.hyperliquid !== null
      }
    };
  } catch (error) {
    console.error('Perps intelligence error:', error.message);
    return {
      success: false,
      error: error.message,
      market,
      timeframe
    };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { market = 'BTC', timeframe = '1d' } = req.query;

  try {
    const intelligence = await getPerpsIntelligence(market.toUpperCase(), timeframe);
    res.status(200).json(intelligence);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
