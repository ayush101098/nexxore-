/**
 * Strategy Builder API — Real Backtesting Engine
 * ═══════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/strategy-builder?action=strategies     → Pre-built strategy templates with live APYs
 *   GET /api/strategy-builder?action=protocols       → Available protocols with live data
 *   GET /api/strategy-builder?action=backtest&strategy=X&period=Y  → Real backtesting
 *   GET /api/strategy-builder?action=regime          → Current market regime analysis
 *   GET /api/strategy-builder?action=signals         → Real trading signals from on-chain data
 *
 * Data Sources:
 *   - DeFi Llama (yields, TVL, protocol data)
 *   - CoinGecko (prices, market data)
 *   - Alternative.me (Fear & Greed Index)
 */

const DEFILLAMA_BASE = 'https://api.llama.fi';
const YIELDS_BASE = 'https://yields.llama.fi';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000;

function getCached(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.data;
  return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

async function fetchJSON(url, cacheKey) {
  const c = getCached(cacheKey || url);
  if (c) return c;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    setCache(cacheKey || url, d);
    return d;
  } catch (e) {
    console.error(`Fetch error ${url}:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  MARKET REGIME DETECTION (Real data from multiple sources)
// ═══════════════════════════════════════════════════════════

async function detectMarketRegime() {
  const [fng, btcData, ethData, globalYields] = await Promise.all([
    fetchJSON('https://api.alternative.me/fng/?limit=30', 'fng_30d'),
    fetchJSON(`${COINGECKO_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=30`, 'btc_30d'),
    fetchJSON(`${COINGECKO_BASE}/coins/ethereum/market_chart?vs_currency=usd&days=30`, 'eth_30d'),
    fetchJSON(`${YIELDS_BASE}/pools`, 'yields_pools')
  ]);

  // Fear & Greed analysis
  const fngValues = fng?.data?.map(d => parseInt(d.value)) || [50];
  const currentFng = fngValues[0];
  const avgFng = fngValues.reduce((a, b) => a + b, 0) / fngValues.length;
  const fngTrend = fngValues[0] - fngValues[Math.min(6, fngValues.length - 1)];

  // BTC volatility (30d)
  const btcPrices = btcData?.prices?.map(p => p[1]) || [];
  const btcReturns = [];
  for (let i = 1; i < btcPrices.length; i++) {
    btcReturns.push((btcPrices[i] - btcPrices[i - 1]) / btcPrices[i - 1]);
  }
  const btcVol = Math.sqrt(btcReturns.reduce((s, r) => s + r * r, 0) / btcReturns.length) * Math.sqrt(365) * 100;
  const btcReturn30d = btcPrices.length > 1 ? ((btcPrices[btcPrices.length - 1] - btcPrices[0]) / btcPrices[0]) * 100 : 0;

  // ETH volatility
  const ethPrices = ethData?.prices?.map(p => p[1]) || [];
  const ethReturns = [];
  for (let i = 1; i < ethPrices.length; i++) {
    ethReturns.push((ethPrices[i] - ethPrices[i - 1]) / ethPrices[i - 1]);
  }
  const ethVol = Math.sqrt(ethReturns.reduce((s, r) => s + r * r, 0) / ethReturns.length) * Math.sqrt(365) * 100;

  // Yield environment analysis
  const stablePools = (globalYields?.data || []).filter(p =>
    p.stablecoin === true && p.tvlUsd > 1000000 && p.apy > 0
  );
  const avgStableYield = stablePools.length > 0
    ? stablePools.reduce((s, p) => s + p.apy, 0) / stablePools.length : 5;

  // Regime classification
  let regime, riskLevel, confidence;
  if (btcVol > 80 || currentFng < 20) {
    regime = 'CRISIS'; riskLevel = 'extreme'; confidence = 0.85;
  } else if (btcVol > 55 || currentFng < 35) {
    regime = 'HIGH_VOLATILITY'; riskLevel = 'high'; confidence = 0.78;
  } else if (btcReturn30d > 15 && currentFng > 65) {
    regime = 'EUPHORIA'; riskLevel = 'high'; confidence = 0.72;
  } else if (btcReturn30d > 5 && currentFng > 50) {
    regime = 'TRENDING_UP'; riskLevel = 'moderate'; confidence = 0.80;
  } else if (btcReturn30d < -5 && currentFng < 40) {
    regime = 'TRENDING_DOWN'; riskLevel = 'moderate'; confidence = 0.75;
  } else if (btcVol < 30) {
    regime = 'LOW_VOLATILITY'; riskLevel = 'low'; confidence = 0.82;
  } else {
    regime = 'NEUTRAL'; riskLevel = 'moderate'; confidence = 0.65;
  }

  return {
    regime, riskLevel, confidence,
    metrics: {
      fearGreed: { current: currentFng, avg30d: Math.round(avgFng), trend: Math.round(fngTrend), label: fng?.data?.[0]?.value_classification || 'Neutral' },
      btc: { price: btcPrices[btcPrices.length - 1]?.toFixed(2), volatility30d: btcVol.toFixed(1), return30d: btcReturn30d.toFixed(2) },
      eth: { price: ethPrices[ethPrices.length - 1]?.toFixed(2), volatility30d: ethVol.toFixed(1) },
      yields: { avgStableYield: avgStableYield.toFixed(2), poolsAnalyzed: stablePools.length }
    },
    recommendations: getRegimeRecommendations(regime, avgStableYield, btcVol),
    timestamp: new Date().toISOString()
  };
}

function getRegimeRecommendations(regime, avgYield, vol) {
  const recs = {
    CRISIS: {
      allocation: { stablecoins: 60, hedgedPerps: 10, yields: 25, cash: 5 },
      message: 'Capital preservation mode. Maximize stablecoin allocation, hedge all exposure.',
      strategies: ['safe-yield', 'stablecoin-defense']
    },
    HIGH_VOLATILITY: {
      allocation: { stablecoins: 40, hedgedPerps: 20, yields: 30, cash: 10 },
      message: 'Elevated vol. Reduce directional exposure, increase hedged structures.',
      strategies: ['balanced-realloc', 'delta-neutral']
    },
    EUPHORIA: {
      allocation: { stablecoins: 25, hedgedPerps: 25, yields: 35, cash: 15 },
      message: 'Market overheated. Take profits, increase cash reserves for drawdown.',
      strategies: ['profit-taking', 'balanced-realloc']
    },
    TRENDING_UP: {
      allocation: { stablecoins: 20, hedgedPerps: 30, yields: 40, cash: 10 },
      message: 'Favorable conditions. Increase yield exposure with moderate hedging.',
      strategies: ['opportunistic-alpha', 'balanced-realloc']
    },
    TRENDING_DOWN: {
      allocation: { stablecoins: 45, hedgedPerps: 15, yields: 30, cash: 10 },
      message: 'Downtrend detected. Increase defensive positions, reduce exposure.',
      strategies: ['safe-yield', 'stablecoin-defense']
    },
    LOW_VOLATILITY: {
      allocation: { stablecoins: 15, hedgedPerps: 35, yields: 40, cash: 10 },
      message: 'Low vol environment. Maximize carry strategies and delta-neutral yield.',
      strategies: ['delta-neutral', 'opportunistic-alpha']
    },
    NEUTRAL: {
      allocation: { stablecoins: 25, hedgedPerps: 25, yields: 40, cash: 10 },
      message: 'Neutral regime. Balanced allocation across strategies.',
      strategies: ['balanced-realloc', 'safe-yield']
    }
  };
  return recs[regime] || recs.NEUTRAL;
}

// ═══════════════════════════════════════════════════════════
//  REAL PROTOCOL DATA
// ═══════════════════════════════════════════════════════════

async function getProtocolData() {
  const [yields, protocols] = await Promise.all([
    fetchJSON(`${YIELDS_BASE}/pools`, 'yields_all'),
    fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'protocols_all')
  ]);

  const topPools = (yields?.data || [])
    .filter(p => p.tvlUsd > 5000000 && p.apy > 0 && p.apy < 100)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 100)
    .map(p => ({
      pool: p.pool,
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      tvl: p.tvlUsd,
      apy: p.apy,
      apyBase: p.apyBase || 0,
      apyReward: p.apyReward || 0,
      stablecoin: p.stablecoin,
      ilRisk: p.ilRisk || 'no',
      exposure: p.exposure || 'single',
      audits: p.audits || '0',
      category: categorizePool(p)
    }));

  const topProtocols = (protocols || [])
    .filter(p => p.tvl > 100000000)
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 50)
    .map(p => ({
      name: p.name,
      slug: p.slug,
      tvl: p.tvl,
      change1d: p.change_1d,
      change7d: p.change_7d,
      chains: p.chains,
      category: p.category
    }));

  return { pools: topPools, protocols: topProtocols, poolCount: topPools.length, protocolCount: topProtocols.length };
}

function categorizePool(pool) {
  if (pool.stablecoin) return 'stable';
  if (pool.symbol?.toLowerCase().includes('eth')) return 'eth-yield';
  if (pool.symbol?.toLowerCase().includes('btc')) return 'btc-yield';
  if (pool.ilRisk === 'yes') return 'lp';
  return 'single-asset';
}

// ═══════════════════════════════════════════════════════════
//  REAL BACKTESTING ENGINE
// ═══════════════════════════════════════════════════════════

async function backtestStrategy(strategyKey, period = 90) {
  const [btcChart, ethChart, yields, fng] = await Promise.all([
    fetchJSON(`${COINGECKO_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${period}`, `btc_${period}d`),
    fetchJSON(`${COINGECKO_BASE}/coins/ethereum/market_chart?vs_currency=usd&days=${period}`, `eth_${period}d`),
    fetchJSON(`${YIELDS_BASE}/pools`, 'yields_pools'),
    fetchJSON(`https://api.alternative.me/fng/?limit=${period}`, `fng_${period}d`)
  ]);

  const btcPrices = btcChart?.prices || [];
  const ethPrices = ethChart?.prices || [];

  // Strategy definitions
  const strategies = {
    'safe-yield': { stableAlloc: 0.70, ethAlloc: 0.15, btcAlloc: 0.15, rebalanceDays: 30, riskMultiplier: 0.3 },
    'balanced-realloc': { stableAlloc: 0.35, ethAlloc: 0.35, btcAlloc: 0.30, rebalanceDays: 14, riskMultiplier: 0.6 },
    'opportunistic-alpha': { stableAlloc: 0.15, ethAlloc: 0.45, btcAlloc: 0.40, rebalanceDays: 7, riskMultiplier: 1.0 },
    'delta-neutral': { stableAlloc: 0.40, ethAlloc: 0.30, btcAlloc: 0.30, rebalanceDays: 3, riskMultiplier: 0.5, hedged: true },
    'stablecoin-defense': { stableAlloc: 0.85, ethAlloc: 0.08, btcAlloc: 0.07, rebalanceDays: 60, riskMultiplier: 0.15 }
  };

  const strat = strategies[strategyKey] || strategies['balanced-realloc'];

  // Get average stable yield from live data
  const stablePools = (yields?.data || []).filter(p => p.stablecoin && p.tvlUsd > 5000000 && p.apy > 0 && p.apy < 50);
  const avgStableAPY = stablePools.length > 0
    ? stablePools.reduce((s, p) => s + p.apy, 0) / stablePools.length : 5;
  const dailyStableReturn = avgStableAPY / 365 / 100;

  // Simulate portfolio over the period
  let portfolio = 10000;
  const equity = [];
  let maxDrawdown = 0;
  let peakValue = portfolio;
  const dailyReturns = [];

  const dataPoints = Math.min(btcPrices.length, ethPrices.length);

  for (let i = 1; i < dataPoints; i++) {
    const btcRet = (btcPrices[i][1] - btcPrices[i - 1][1]) / btcPrices[i - 1][1];
    const ethRet = (ethPrices[i][1] - ethPrices[i - 1][1]) / ethPrices[i - 1][1];

    // Apply hedging (reduces volatile exposure by 50% for delta-neutral)
    const hedgeFactor = strat.hedged ? 0.5 : 1.0;

    const dailyReturn =
      (strat.stableAlloc * dailyStableReturn) +
      (strat.ethAlloc * ethRet * hedgeFactor * strat.riskMultiplier) +
      (strat.btcAlloc * btcRet * hedgeFactor * strat.riskMultiplier);

    portfolio *= (1 + dailyReturn);
    dailyReturns.push(dailyReturn);

    equity.push({
      date: new Date(btcPrices[i][0]).toISOString().split('T')[0],
      value: parseFloat(portfolio.toFixed(2)),
      btcPrice: btcPrices[i][1],
      ethPrice: ethPrices[i][1]
    });

    if (portfolio > peakValue) peakValue = portfolio;
    const dd = (peakValue - portfolio) / peakValue;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Calculate real metrics
  const totalReturn = ((portfolio - 10000) / 10000) * 100;
  const annualizedReturn = (Math.pow(portfolio / 10000, 365 / dataPoints) - 1) * 100;
  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgDailyReturn) ** 2, 0) / dailyReturns.length);
  const sharpe = stdDev > 0 ? (avgDailyReturn / stdDev) * Math.sqrt(365) : 0;
  const sortino = (() => {
    const downReturns = dailyReturns.filter(r => r < 0);
    const downDev = Math.sqrt(downReturns.reduce((s, r) => s + r * r, 0) / (downReturns.length || 1));
    return downDev > 0 ? (avgDailyReturn / downDev) * Math.sqrt(365) : 0;
  })();

  // VaR and CVaR
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const var95Index = Math.floor(sortedReturns.length * 0.05);
  const var95 = sortedReturns[var95Index] || 0;
  const cvar95 = sortedReturns.slice(0, var95Index + 1).reduce((s, r) => s + r, 0) / (var95Index + 1 || 1);

  return {
    strategy: strategyKey,
    period: `${period}d`,
    startingCapital: 10000,
    finalValue: parseFloat(portfolio.toFixed(2)),
    metrics: {
      totalReturn: parseFloat(totalReturn.toFixed(2)),
      annualizedReturn: parseFloat(annualizedReturn.toFixed(2)),
      sharpeRatio: parseFloat(sharpe.toFixed(3)),
      sortinoRatio: parseFloat(sortino.toFixed(3)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      volatility: parseFloat((stdDev * Math.sqrt(365) * 100).toFixed(2)),
      var95: parseFloat((var95 * 100).toFixed(3)),
      cvar95: parseFloat((cvar95 * 100).toFixed(3)),
      winRate: parseFloat(((dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100).toFixed(1))
    },
    allocation: strat,
    avgStableYield: parseFloat(avgStableAPY.toFixed(2)),
    equityCurve: equity.filter((_, i) => i % Math.max(1, Math.floor(equity.length / 90)) === 0),
    dataPoints,
    timestamp: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════
//  REAL TRADING SIGNALS FROM ON-CHAIN DATA
// ═══════════════════════════════════════════════════════════

async function generateRealSignals() {
  const [regime, protocols, yields] = await Promise.all([
    detectMarketRegime(),
    fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'protocols_all'),
    fetchJSON(`${YIELDS_BASE}/pools`, 'yields_pools')
  ]);

  const signals = [];

  // Signal 1: Regime-based allocation signal
  signals.push({
    type: 'REGIME',
    action: regime.regime === 'TRENDING_UP' || regime.regime === 'LOW_VOLATILITY' ? 'INCREASE_EXPOSURE' : 'REDUCE_EXPOSURE',
    asset: 'PORTFOLIO',
    confidence: regime.confidence,
    reason: `Market regime: ${regime.regime}. ${regime.recommendations.message}`,
    timestamp: new Date().toISOString()
  });

  // Signal 2: Top yield opportunities
  const topYield = (yields?.data || [])
    .filter(p => p.stablecoin && p.tvlUsd > 10000000 && p.apy > 5 && p.apy < 50)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, 3);

  topYield.forEach(p => {
    signals.push({
      type: 'YIELD_OPPORTUNITY',
      action: 'ALLOCATE',
      asset: p.symbol,
      protocol: p.project,
      chain: p.chain,
      apy: parseFloat(p.apy.toFixed(2)),
      tvl: p.tvlUsd,
      confidence: 0.7 + (p.tvlUsd > 100000000 ? 0.1 : 0),
      reason: `High-TVL stablecoin yield: ${p.apy.toFixed(2)}% APY on ${p.project} (${p.chain})`,
      timestamp: new Date().toISOString()
    });
  });

  // Signal 3: TVL flow signals
  const tvlMovers = (protocols || [])
    .filter(p => p.tvl > 50000000 && Math.abs(p.change_1d || 0) > 5)
    .sort((a, b) => Math.abs(b.change_1d || 0) - Math.abs(a.change_1d || 0))
    .slice(0, 3);

  tvlMovers.forEach(p => {
    const isInflow = (p.change_1d || 0) > 0;
    signals.push({
      type: 'TVL_FLOW',
      action: isInflow ? 'MONITOR_OPPORTUNITY' : 'RISK_ALERT',
      asset: p.name,
      change1d: parseFloat((p.change_1d || 0).toFixed(2)),
      tvl: p.tvl,
      confidence: 0.65,
      reason: `${p.name}: ${isInflow ? '+' : ''}${(p.change_1d || 0).toFixed(2)}% TVL change in 24h ($${(p.tvl / 1e9).toFixed(2)}B TVL)`,
      timestamp: new Date().toISOString()
    });
  });

  // Signal 4: Fear & Greed extremes
  if (regime.metrics.fearGreed.current < 25 || regime.metrics.fearGreed.current > 75) {
    signals.push({
      type: 'SENTIMENT',
      action: regime.metrics.fearGreed.current < 25 ? 'CONTRARIAN_BUY' : 'CONTRARIAN_SELL',
      asset: 'MARKET',
      confidence: 0.60,
      reason: `Fear & Greed at ${regime.metrics.fearGreed.current} (${regime.metrics.fearGreed.label}). Extreme readings often precede reversals.`,
      timestamp: new Date().toISOString()
    });
  }

  return {
    signals,
    regime: regime.regime,
    signalCount: signals.length,
    timestamp: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════
//  STRATEGY TEMPLATES WITH LIVE DATA
// ═══════════════════════════════════════════════════════════

async function getStrategyTemplates() {
  const [yields, regime] = await Promise.all([
    fetchJSON(`${YIELDS_BASE}/pools`, 'yields_pools'),
    detectMarketRegime()
  ]);

  const stablePools = (yields?.data || []).filter(p => p.stablecoin && p.tvlUsd > 5000000 && p.apy > 0);
  const avgStableAPY = stablePools.length > 0 ? stablePools.reduce((s, p) => s + p.apy, 0) / stablePools.length : 5;
  const topStableAPY = stablePools.length > 0 ? Math.max(...stablePools.map(p => p.apy)) : 15;

  const templates = [
    {
      key: 'safe-yield',
      name: 'Safe Yield',
      description: 'Capital preservation with stablecoin-heavy allocation. Minimal directional exposure.',
      riskLevel: 'low',
      allocation: { stablecoins: 70, eth: 15, btc: 15 },
      expectedAPY: { min: parseFloat((avgStableAPY * 0.6).toFixed(1)), max: parseFloat((avgStableAPY * 1.2).toFixed(1)) },
      maxDrawdown: '~3-5%',
      rebalanceFrequency: '30 days',
      regimeMatch: regime.regime === 'CRISIS' || regime.regime === 'HIGH_VOLATILITY' ? 'optimal' : 'suitable'
    },
    {
      key: 'balanced-realloc',
      name: 'Balanced Reallocation',
      description: 'Dynamic rebalancing across yield sources. Regime-aware position sizing.',
      riskLevel: 'medium',
      allocation: { stablecoins: 35, eth: 35, btc: 30 },
      expectedAPY: { min: parseFloat((avgStableAPY * 0.8).toFixed(1)), max: parseFloat((topStableAPY * 0.7).toFixed(1)) },
      maxDrawdown: '~8-15%',
      rebalanceFrequency: '14 days',
      regimeMatch: regime.regime === 'NEUTRAL' || regime.regime === 'TRENDING_UP' ? 'optimal' : 'suitable'
    },
    {
      key: 'opportunistic-alpha',
      name: 'Opportunistic Alpha',
      description: 'Aggressive yield farming with high directional exposure. Best in trending markets.',
      riskLevel: 'high',
      allocation: { stablecoins: 15, eth: 45, btc: 40 },
      expectedAPY: { min: parseFloat((avgStableAPY * 1.5).toFixed(1)), max: parseFloat((topStableAPY * 1.2).toFixed(1)) },
      maxDrawdown: '~15-30%',
      rebalanceFrequency: '7 days',
      regimeMatch: regime.regime === 'TRENDING_UP' || regime.regime === 'LOW_VOLATILITY' ? 'optimal' : 'risky'
    },
    {
      key: 'delta-neutral',
      name: 'Delta-Neutral Carry',
      description: 'Hedged exposure capturing funding rates and basis spread. Market-direction agnostic.',
      riskLevel: 'medium-low',
      allocation: { stablecoins: 40, eth: 30, btc: 30 },
      expectedAPY: { min: parseFloat((avgStableAPY * 0.7).toFixed(1)), max: parseFloat((avgStableAPY * 1.8).toFixed(1)) },
      maxDrawdown: '~5-10%',
      rebalanceFrequency: '3 days',
      regimeMatch: regime.regime === 'LOW_VOLATILITY' ? 'optimal' : 'suitable'
    },
    {
      key: 'stablecoin-defense',
      name: 'Stablecoin Defense',
      description: 'Maximum capital preservation. 85%+ in stablecoins, minimal volatile exposure.',
      riskLevel: 'minimal',
      allocation: { stablecoins: 85, eth: 8, btc: 7 },
      expectedAPY: { min: parseFloat((avgStableAPY * 0.5).toFixed(1)), max: parseFloat((avgStableAPY * 0.9).toFixed(1)) },
      maxDrawdown: '~1-3%',
      rebalanceFrequency: '60 days',
      regimeMatch: regime.regime === 'CRISIS' ? 'optimal' : 'conservative'
    }
  ];

  return { strategies: templates, currentRegime: regime, avgStableYield: parseFloat(avgStableAPY.toFixed(2)) };
}

// ═══════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || 'strategies';

  try {
    switch (action) {
      case 'strategies':
        return res.status(200).json(await getStrategyTemplates());
      case 'protocols':
        return res.status(200).json(await getProtocolData());
      case 'backtest': {
        const strategy = url.searchParams.get('strategy') || 'balanced-realloc';
        const period = parseInt(url.searchParams.get('period') || '90');
        return res.status(200).json(await backtestStrategy(strategy, Math.min(period, 365)));
      }
      case 'regime':
        return res.status(200).json(await detectMarketRegime());
      case 'signals':
        return res.status(200).json(await generateRealSignals());
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('Strategy Builder error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.getStrategies = getStrategyTemplates;
module.exports.backtest = backtestStrategy;
module.exports.regime = detectMarketRegime;
module.exports.signals = generateRealSignals;
module.exports.protocols = getProtocolData;
