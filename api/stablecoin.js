/**
 * Stablecoin Hub API — Real Stablecoin Intelligence
 * ═══════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/stablecoin?action=overview     → Market overview (mcap, dominance, peg data)
 *   GET /api/stablecoin?action=yields       → Live stablecoin yield opportunities
 *   GET /api/stablecoin?action=pegs         → Real-time peg tracking for all stablecoins
 *   GET /api/stablecoin?action=chains       → Chain-by-chain stablecoin distribution
 *   GET /api/stablecoin?action=risk         → Risk scoring for each stablecoin
 *
 * Data Sources:
 *   - DeFi Llama Stablecoins API (mcap, chains, peg history)
 *   - DeFi Llama Yields API (stablecoin yield pools)
 *   - CoinGecko (price/peg deviation)
 */

const STABLECOINS_BASE = 'https://stablecoins.llama.fi';
const YIELDS_BASE = 'https://yields.llama.fi';
const DEFILLAMA_BASE = 'https://api.llama.fi';
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
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
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
//  STABLECOIN OVERVIEW — Total market, top stablecoins, flows
// ═══════════════════════════════════════════════════════════

async function getOverview() {
  const [stablecoins, chains] = await Promise.all([
    fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'sc_all'),
    fetchJSON(`${STABLECOINS_BASE}/stablecoinchains`, 'sc_chains')
  ]);

  if (!stablecoins?.peggedAssets) {
    return { error: 'Failed to fetch stablecoin data' };
  }

  const assets = stablecoins.peggedAssets;
  
  // Total market cap
  const totalMcap = assets.reduce((sum, a) => {
    const mcap = a.circulating?.peggedUSD || 0;
    return sum + mcap;
  }, 0);

  // Top stablecoins with full data
  const topStables = assets
    .filter(a => (a.circulating?.peggedUSD || 0) > 10_000_000)
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 20)
    .map(a => {
      const mcap = a.circulating?.peggedUSD || 0;
      const price = a.price || 1;
      const pegDev = Math.abs(price - 1) * 100;
      const chains = a.chains || [];
      
      // 7d change from circulating data
      const change7d = a.circulatingPrevDay?.peggedUSD 
        ? ((mcap - (a.circulatingPrevDay?.peggedUSD || mcap)) / (a.circulatingPrevDay?.peggedUSD || mcap) * 100)
        : 0;

      return {
        name: a.name,
        symbol: a.symbol,
        mcap,
        price,
        pegDeviation: pegDev,
        pegStatus: pegDev < 0.1 ? 'stable' : pegDev < 0.5 ? 'minor' : pegDev < 2 ? 'warning' : 'critical',
        change7d,
        chains: chains.length,
        topChains: chains.slice(0, 5),
        type: a.pegType || 'fiat-backed',
        dominance: (mcap / totalMcap * 100)
      };
    });

  // Chain distribution
  const chainDist = (chains || [])
    .sort((a, b) => (b.totalCirculatingUSD?.peggedUSD || 0) - (a.totalCirculatingUSD?.peggedUSD || 0))
    .slice(0, 15)
    .map(c => ({
      chain: c.name,
      totalUSD: c.totalCirculatingUSD?.peggedUSD || 0,
      dominance: (c.totalCirculatingUSD?.peggedUSD || 0) / totalMcap * 100
    }));

  // Market health
  const avgPegDev = topStables.reduce((s, t) => s + t.pegDeviation, 0) / topStables.length;
  const stableCount = topStables.filter(t => t.pegStatus === 'stable').length;

  return {
    totalMarketCap: totalMcap,
    totalStablecoins: assets.length,
    topStablecoins: topStables,
    chainDistribution: chainDist,
    marketHealth: {
      avgPegDeviation: avgPegDev,
      stableCount,
      warningCount: topStables.filter(t => t.pegStatus === 'warning' || t.pegStatus === 'critical').length,
      healthScore: Math.max(0, 100 - avgPegDev * 50 - (20 - stableCount) * 2)
    },
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  STABLECOIN YIELDS — Live yield opportunities
// ═══════════════════════════════════════════════════════════

async function getYields() {
  const pools = await fetchJSON(`${YIELDS_BASE}/pools`, 'sc_yields');
  if (!pools?.data) return { error: 'Failed to fetch yield data' };

  const stableSymbols = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'GHO', 'crvUSD', 'PYUSD', 'USDD', 'TUSD', 'BUSD', 'sUSD', 'USDP', 'GUSD', 'eUSD', 'mkUSD', 'USDe', 'USDS'];
  
  const stablePools = pools.data
    .filter(p => {
      const sym = (p.symbol || '').toUpperCase();
      return stableSymbols.some(s => sym.includes(s)) && 
             p.tvlUsd > 500_000 &&
             p.apy > 0.1 && p.apy < 100;
    })
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 60)
    .map(p => ({
      pool: p.pool,
      symbol: p.symbol,
      project: p.project,
      chain: p.chain,
      tvl: p.tvlUsd,
      apy: p.apy,
      apyBase: p.apyBase || 0,
      apyReward: p.apyReward || 0,
      apyMean30d: p.apyMean30d || p.apy,
      il7d: p.ilRisk === 'no' ? 0 : (p.il7d || 0),
      stablecoin: p.stablecoin || true,
      exposure: p.exposure || 'single',
      riskLevel: getRiskLevel(p)
    }));

  // Group by stablecoin
  const byAsset = {};
  stablePools.forEach(p => {
    const asset = stableSymbols.find(s => p.symbol.toUpperCase().includes(s)) || 'OTHER';
    if (!byAsset[asset]) byAsset[asset] = [];
    byAsset[asset].push(p);
  });

  // Best opportunities
  const bestByRisk = {
    conservative: stablePools.filter(p => p.riskLevel === 'low').sort((a, b) => b.apy - a.apy).slice(0, 5),
    balanced: stablePools.filter(p => p.riskLevel === 'medium').sort((a, b) => b.apy - a.apy).slice(0, 5),
    aggressive: stablePools.filter(p => p.riskLevel === 'high').sort((a, b) => b.apy - a.apy).slice(0, 5)
  };

  return {
    totalPools: stablePools.length,
    pools: stablePools,
    byAsset,
    bestOpportunities: bestByRisk,
    avgApy: stablePools.reduce((s, p) => s + p.apy, 0) / stablePools.length,
    totalTvl: stablePools.reduce((s, p) => s + p.tvl, 0),
    timestamp: Date.now()
  };
}

function getRiskLevel(pool) {
  let score = 0;
  if (pool.tvlUsd > 50_000_000) score -= 2;
  else if (pool.tvlUsd > 10_000_000) score -= 1;
  else if (pool.tvlUsd < 1_000_000) score += 2;
  
  if (pool.apy > 20) score += 2;
  else if (pool.apy > 10) score += 1;
  
  if (pool.stablecoin) score -= 1;
  if (pool.ilRisk === 'yes') score += 2;
  
  const project = (pool.project || '').toLowerCase();
  const blueChips = ['aave', 'compound', 'maker', 'curve', 'convex', 'yearn', 'lido', 'morpho'];
  if (blueChips.some(b => project.includes(b))) score -= 2;
  
  if (score <= 0) return 'low';
  if (score <= 2) return 'medium';
  return 'high';
}

// ═══════════════════════════════════════════════════════════
//  PEG TRACKING — Real-time peg data for all major stablecoins
// ═══════════════════════════════════════════════════════════

async function getPegData() {
  const [stablecoins, prices] = await Promise.all([
    fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'sc_all'),
    fetchJSON(`${COINGECKO_BASE}/simple/price?ids=tether,usd-coin,dai,frax,liquity-usd,gho,crvusd,paypal-usd,ethena-usde&vs_currencies=usd&include_24hr_change=true`, 'sc_prices')
  ]);

  if (!stablecoins?.peggedAssets) return { error: 'Failed to fetch peg data' };

  const cgMapping = {
    'USDT': 'tether', 'USDC': 'usd-coin', 'DAI': 'dai', 'FRAX': 'frax',
    'LUSD': 'liquity-usd', 'GHO': 'gho', 'crvUSD': 'crvusd', 'PYUSD': 'paypal-usd', 'USDe': 'ethena-usde'
  };

  const assets = stablecoins.peggedAssets
    .filter(a => (a.circulating?.peggedUSD || 0) > 50_000_000)
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 15)
    .map(a => {
      const mcap = a.circulating?.peggedUSD || 0;
      const cgId = cgMapping[a.symbol];
      const cgPrice = cgId && prices?.[cgId] ? prices[cgId].usd : null;
      const price = cgPrice || a.price || 1;
      const deviation = (price - 1) * 100; // positive = above peg, negative = below

      return {
        name: a.name,
        symbol: a.symbol,
        price,
        deviation,
        absDeviation: Math.abs(deviation),
        mcap,
        pegType: a.pegType || 'unknown',
        pegMechanism: a.pegMechanism || 'unknown',
        status: Math.abs(deviation) < 0.05 ? 'perfect' :
                Math.abs(deviation) < 0.2 ? 'stable' :
                Math.abs(deviation) < 1 ? 'minor_deviation' :
                Math.abs(deviation) < 3 ? 'warning' : 'critical',
        chains: (a.chains || []).length,
        change24h: cgId && prices?.[cgId] ? prices[cgId].usd_24h_change || 0 : 0
      };
    });

  const healthIndex = assets.reduce((s, a) => {
    if (a.status === 'perfect' || a.status === 'stable') return s + 1;
    return s;
  }, 0) / assets.length * 100;

  return {
    stablecoins: assets,
    marketHealth: {
      healthIndex,
      avgDeviation: assets.reduce((s, a) => s + a.absDeviation, 0) / assets.length,
      criticalCount: assets.filter(a => a.status === 'critical' || a.status === 'warning').length,
      totalMonitored: assets.length
    },
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  CHAIN DISTRIBUTION — Where stablecoins live across chains
// ═══════════════════════════════════════════════════════════

async function getChainDistribution() {
  const [chains, stablecoins] = await Promise.all([
    fetchJSON(`${STABLECOINS_BASE}/stablecoinchains`, 'sc_chains'),
    fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'sc_all')
  ]);

  if (!chains) return { error: 'Failed to fetch chain data' };

  const totalMcap = (stablecoins?.peggedAssets || []).reduce((sum, a) => sum + (a.circulating?.peggedUSD || 0), 0);

  const chainData = chains
    .sort((a, b) => (b.totalCirculatingUSD?.peggedUSD || 0) - (a.totalCirculatingUSD?.peggedUSD || 0))
    .slice(0, 20)
    .map(c => ({
      chain: c.name,
      totalUSD: c.totalCirculatingUSD?.peggedUSD || 0,
      dominance: totalMcap > 0 ? ((c.totalCirculatingUSD?.peggedUSD || 0) / totalMcap * 100) : 0
    }));

  return {
    chains: chainData,
    totalMarketCap: totalMcap,
    topChain: chainData[0]?.chain || 'Ethereum',
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  RISK SCORING — Comprehensive risk analysis per stablecoin
// ═══════════════════════════════════════════════════════════

async function getRiskScoring() {
  const stablecoins = await fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'sc_all');
  if (!stablecoins?.peggedAssets) return { error: 'Failed to fetch data' };

  const riskProfiles = stablecoins.peggedAssets
    .filter(a => (a.circulating?.peggedUSD || 0) > 100_000_000)
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 15)
    .map(a => {
      const mcap = a.circulating?.peggedUSD || 0;
      const price = a.price || 1;
      const pegDev = Math.abs(price - 1);
      const chains = (a.chains || []).length;
      const pegType = (a.pegType || '').toLowerCase();

      // Risk scoring (0-100, lower = safer)
      let riskScore = 0;
      
      // Size factor (larger = safer)
      if (mcap > 50_000_000_000) riskScore += 0;
      else if (mcap > 10_000_000_000) riskScore += 5;
      else if (mcap > 1_000_000_000) riskScore += 15;
      else riskScore += 30;

      // Peg stability
      if (pegDev < 0.001) riskScore += 0;
      else if (pegDev < 0.005) riskScore += 5;
      else if (pegDev < 0.02) riskScore += 15;
      else riskScore += 35;

      // Type risk
      if (pegType.includes('fiatbacked') || a.symbol === 'USDC' || a.symbol === 'USDT') riskScore += 0;
      else if (pegType.includes('overcollateralized') || a.symbol === 'DAI') riskScore += 10;
      else if (pegType.includes('algorithmic')) riskScore += 30;
      else riskScore += 15;

      // Chain diversification (more = safer)
      if (chains > 15) riskScore -= 5;
      else if (chains > 5) riskScore -= 2;

      riskScore = Math.max(0, Math.min(100, riskScore));

      return {
        name: a.name,
        symbol: a.symbol,
        mcap,
        price,
        riskScore,
        riskLevel: riskScore <= 15 ? 'A+' : riskScore <= 25 ? 'A' : riskScore <= 40 ? 'B' : riskScore <= 60 ? 'C' : 'D',
        factors: {
          sizeScore: mcap > 10_000_000_000 ? 'excellent' : mcap > 1_000_000_000 ? 'good' : 'moderate',
          pegStability: pegDev < 0.005 ? 'excellent' : pegDev < 0.02 ? 'good' : 'concerning',
          typeRisk: pegType.includes('fiatbacked') ? 'low' : pegType.includes('overcollateralized') ? 'moderate' : 'higher',
          chainDiversity: chains > 10 ? 'excellent' : chains > 5 ? 'good' : 'limited'
        },
        chains,
        pegType: a.pegType
      };
    });

  return {
    riskProfiles,
    safest: riskProfiles.filter(r => r.riskLevel === 'A+' || r.riskLevel === 'A'),
    needsAttention: riskProfiles.filter(r => r.riskLevel === 'C' || r.riskLevel === 'D'),
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || 'overview';

  try {
    let data;
    switch (action) {
      case 'overview': data = await getOverview(); break;
      case 'yields': data = await getYields(); break;
      case 'pegs': data = await getPegData(); break;
      case 'chains': data = await getChainDistribution(); break;
      case 'risk': data = await getRiskScoring(); break;
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    res.status(200).json(data);
  } catch (err) {
    console.error('Stablecoin API error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Export for use by other modules
module.exports.getOverview = getOverview;
module.exports.getYields = getYields;
module.exports.getPegData = getPegData;
module.exports.getChainDistribution = getChainDistribution;
module.exports.getRiskScoring = getRiskScoring;
