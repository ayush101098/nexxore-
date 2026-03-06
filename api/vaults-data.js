/**
 * Vaults Data API — Real Multi-Chain Vault & Yield Intelligence
 * ═══════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/vaults-data?action=overview    → Vault market overview with live APYs
 *   GET /api/vaults-data?action=pools       → Top yield pools with risk scoring
 *   GET /api/vaults-data?action=protocols   → Protocol-level vault data
 *   GET /api/vaults-data?action=compare     → Side-by-side vault comparison
 *   GET /api/vaults-data?action=allocate&risk=X&amount=Y → AI allocation suggestion
 *
 * Data Sources:
 *   - DeFi Llama Yields API (pools, APYs)
 *   - DeFi Llama Protocols API (TVL, chains)
 *   - CoinGecko (asset prices)
 */

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
//  VAULT MARKET OVERVIEW — Live stats across all yield sources
// ═══════════════════════════════════════════════════════════

async function getOverview() {
  const [pools, protocols] = await Promise.all([
    fetchJSON(`${YIELDS_BASE}/pools`, 'v_pools'),
    fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'v_protocols')
  ]);

  if (!pools?.data) return { error: 'Failed to fetch pool data' };

  const allPools = pools.data.filter(p => p.tvlUsd > 100_000 && p.apy > 0 && p.apy < 200);
  
  // Market-wide stats
  const totalTvl = allPools.reduce((s, p) => s + p.tvlUsd, 0);
  const avgApy = allPools.reduce((s, p) => s + p.apy, 0) / allPools.length;
  const stablePools = allPools.filter(p => p.stablecoin);
  const avgStableApy = stablePools.reduce((s, p) => s + p.apy, 0) / (stablePools.length || 1);

  // Top vault protocols by TVL
  const vaultProtocols = ['aave', 'compound', 'yearn', 'morpho', 'convex', 'curve', 'lido', 'rocket-pool', 'maker', 'eigenlayer', 'ethena', 'pendle', 'beefy', 'sommelier', 'gearbox'];
  const topProtocols = (protocols || [])
    .filter(p => vaultProtocols.some(v => (p.slug || '').toLowerCase().includes(v) || (p.name || '').toLowerCase().includes(v)))
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 12)
    .map(p => ({
      name: p.name,
      slug: p.slug,
      tvl: p.tvl,
      change1d: p.change_1d || 0,
      change7d: p.change_7d || 0,
      chains: p.chains || [],
      category: p.category
    }));

  // Chain breakdown
  const chainTvl = {};
  allPools.forEach(p => {
    const chain = p.chain || 'Unknown';
    if (!chainTvl[chain]) chainTvl[chain] = { tvl: 0, pools: 0, avgApy: 0, totalApy: 0 };
    chainTvl[chain].tvl += p.tvlUsd;
    chainTvl[chain].pools += 1;
    chainTvl[chain].totalApy += p.apy;
  });
  const chainBreakdown = Object.entries(chainTvl)
    .map(([chain, d]) => ({ chain, tvl: d.tvl, pools: d.pools, avgApy: d.totalApy / d.pools }))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, 12);

  // Category overview
  const safeYieldRange = stablePools.length > 0
    ? { min: Math.min(...stablePools.slice(0, 100).map(p => p.apy)), max: Math.max(...stablePools.filter(p => p.apy < 30).map(p => p.apy)) }
    : { min: 3, max: 15 };

  const advancedPools = allPools.filter(p => !p.stablecoin && p.apy > 5);
  const advancedRange = advancedPools.length > 0
    ? { min: 5, max: Math.min(50, Math.max(...advancedPools.filter(p => p.apy < 60).slice(0, 50).map(p => p.apy))) }
    : { min: 8, max: 25 };

  return {
    market: {
      totalTvl,
      totalPools: allPools.length,
      avgApy,
      avgStableApy,
      totalProtocols: topProtocols.length
    },
    vaultStrategies: {
      safeYield: {
        name: 'Safe Yield',
        risk: 'Low',
        apyRange: safeYieldRange,
        tvl: stablePools.reduce((s, p) => s + p.tvlUsd, 0),
        poolCount: stablePools.length,
        description: 'Stablecoin lending & LP positions on blue-chip protocols'
      },
      advancedRealloc: {
        name: 'Advanced Realloc',
        risk: 'Medium-High',
        apyRange: advancedRange,
        tvl: advancedPools.reduce((s, p) => s + p.tvlUsd, 0),
        poolCount: advancedPools.length,
        description: 'Dynamic multi-asset strategies with active rebalancing'
      }
    },
    topProtocols,
    chainBreakdown,
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  TOP YIELD POOLS — Best opportunities with risk scoring
// ═══════════════════════════════════════════════════════════

async function getPools(params = {}) {
  const pools = await fetchJSON(`${YIELDS_BASE}/pools`, 'v_pools');
  if (!pools?.data) return { error: 'Failed to fetch pool data' };

  const chain = params.chain || 'all';
  const riskFilter = params.risk || 'all';
  const stableOnly = params.stable === 'true';
  const minTvl = parseInt(params.minTvl) || 1_000_000;
  const sortBy = params.sort || 'tvl';

  let filtered = pools.data.filter(p => 
    p.tvlUsd > minTvl && 
    p.apy > 0.1 && 
    p.apy < 150
  );

  if (chain !== 'all') {
    filtered = filtered.filter(p => (p.chain || '').toLowerCase() === chain.toLowerCase());
  }
  if (stableOnly) {
    filtered = filtered.filter(p => p.stablecoin);
  }

  // Score each pool
  const scored = filtered.map(p => {
    const risk = scorePoolRisk(p);
    return {
      pool: p.pool,
      symbol: p.symbol,
      project: p.project,
      chain: p.chain,
      tvl: p.tvlUsd,
      apy: p.apy,
      apyBase: p.apyBase || 0,
      apyReward: p.apyReward || 0,
      apyMean30d: p.apyMean30d || p.apy,
      stablecoin: p.stablecoin || false,
      ilRisk: p.ilRisk || 'no',
      riskScore: risk.score,
      riskLevel: risk.level,
      riskFactors: risk.factors,
      apyPctChange7d: p.apyPct7D || 0,
      apyPctChange30d: p.apyPct30D || 0,
      volumeUsd7d: p.volumeUsd7d || 0
    };
  });

  if (riskFilter !== 'all') {
    const riskMap = { low: ['A+', 'A'], medium: ['B', 'B+'], high: ['C', 'D'] };
    const allowed = riskMap[riskFilter] || [];
    scored.filter(p => allowed.includes(p.riskLevel));
  }

  // Sort
  if (sortBy === 'apy') scored.sort((a, b) => b.apy - a.apy);
  else if (sortBy === 'risk') scored.sort((a, b) => a.riskScore - b.riskScore);
  else scored.sort((a, b) => b.tvl - a.tvl);

  return {
    pools: scored.slice(0, 50),
    totalMatching: scored.length,
    filters: { chain, riskFilter, stableOnly, minTvl, sortBy },
    timestamp: Date.now()
  };
}

function scorePoolRisk(pool) {
  let score = 50; // start at medium
  const factors = [];

  // TVL factor
  if (pool.tvlUsd > 100_000_000) { score -= 15; factors.push('Large TVL (+)'); }
  else if (pool.tvlUsd > 10_000_000) { score -= 8; factors.push('Good TVL (+)'); }
  else if (pool.tvlUsd < 1_000_000) { score += 15; factors.push('Low TVL (-)'); }

  // APY factor (extremely high = likely unsustainable)
  if (pool.apy > 50) { score += 20; factors.push('Very high APY (-)'); }
  else if (pool.apy > 20) { score += 8; factors.push('High APY (neutral)'); }
  else if (pool.apy < 8) { score -= 5; factors.push('Conservative APY (+)'); }

  // Stablecoin
  if (pool.stablecoin) { score -= 10; factors.push('Stablecoin (+)'); }
  
  // IL risk
  if (pool.ilRisk === 'yes') { score += 10; factors.push('IL risk (-)'); }
  
  // Protocol reputation
  const project = (pool.project || '').toLowerCase();
  const tier1 = ['aave', 'compound', 'maker', 'lido', 'curve', 'convex', 'uniswap'];
  const tier2 = ['yearn', 'morpho', 'pendle', 'beefy', 'eigenlayer', 'rocket-pool'];
  if (tier1.some(t => project.includes(t))) { score -= 15; factors.push('Tier-1 protocol (+)'); }
  else if (tier2.some(t => project.includes(t))) { score -= 8; factors.push('Tier-2 protocol (+)'); }

  // APY stability
  const apyChange = Math.abs(pool.apyPct30D || 0);
  if (apyChange > 50) { score += 10; factors.push('Volatile APY (-)'); }
  else if (apyChange < 10) { score -= 5; factors.push('Stable APY (+)'); }

  score = Math.max(0, Math.min(100, score));

  let level = 'C';
  if (score <= 20) level = 'A+';
  else if (score <= 30) level = 'A';
  else if (score <= 40) level = 'B+';
  else if (score <= 55) level = 'B';
  else if (score <= 70) level = 'C';
  else level = 'D';

  return { score, level, factors };
}

// ═══════════════════════════════════════════════════════════
//  PROTOCOL VAULT DATA — Deep protocol-level intel
// ═══════════════════════════════════════════════════════════

async function getProtocolVaults() {
  const [pools, protocols] = await Promise.all([
    fetchJSON(`${YIELDS_BASE}/pools`, 'v_pools'),
    fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'v_protocols')
  ]);

  if (!pools?.data || !protocols) return { error: 'Failed to fetch data' };

  // Group pools by project
  const byProject = {};
  pools.data
    .filter(p => p.tvlUsd > 500_000 && p.apy > 0 && p.apy < 200)
    .forEach(p => {
      const proj = p.project || 'unknown';
      if (!byProject[proj]) byProject[proj] = { pools: [], totalTvl: 0, apys: [] };
      byProject[proj].pools.push(p);
      byProject[proj].totalTvl += p.tvlUsd;
      byProject[proj].apys.push(p.apy);
    });

  // Enrich with protocol data
  const protocolMap = {};
  protocols.forEach(p => { protocolMap[(p.slug || '').toLowerCase()] = p; });

  const vaultProtocols = Object.entries(byProject)
    .filter(([_, d]) => d.totalTvl > 10_000_000)
    .sort(([_, a], [__, b]) => b.totalTvl - a.totalTvl)
    .slice(0, 25)
    .map(([project, data]) => {
      const proto = protocolMap[project.toLowerCase()] || {};
      const apys = data.apys;
      return {
        name: proto.name || project,
        slug: project,
        tvl: data.totalTvl,
        protocolTvl: proto.tvl || data.totalTvl,
        poolCount: data.pools.length,
        avgApy: apys.reduce((s, a) => s + a, 0) / apys.length,
        medianApy: apys.sort((a, b) => a - b)[Math.floor(apys.length / 2)] || 0,
        maxApy: Math.max(...apys),
        minApy: Math.min(...apys),
        chains: [...new Set(data.pools.map(p => p.chain))],
        category: proto.category || 'Yield',
        change1d: proto.change_1d || 0,
        change7d: proto.change_7d || 0,
        hasStablePools: data.pools.some(p => p.stablecoin),
        topPools: data.pools
          .sort((a, b) => b.tvlUsd - a.tvlUsd)
          .slice(0, 5)
          .map(p => ({
            symbol: p.symbol,
            chain: p.chain,
            tvl: p.tvlUsd,
            apy: p.apy
          }))
      };
    });

  return {
    protocols: vaultProtocols,
    totalProtocols: vaultProtocols.length,
    totalTvl: vaultProtocols.reduce((s, p) => s + p.tvl, 0),
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  VAULT COMPARISON — Side-by-side Safe vs Advanced
// ═══════════════════════════════════════════════════════════

async function compareVaults() {
  const pools = await fetchJSON(`${YIELDS_BASE}/pools`, 'v_pools');
  if (!pools?.data) return { error: 'Failed to fetch pool data' };

  const allPools = pools.data.filter(p => p.tvlUsd > 1_000_000 && p.apy > 0 && p.apy < 100);

  // Safe Yield = stablecoin pools on blue-chip protocols
  const blueChips = ['aave', 'compound', 'maker', 'curve', 'convex', 'morpho', 'yearn'];
  const safePools = allPools.filter(p => 
    p.stablecoin && 
    blueChips.some(b => (p.project || '').toLowerCase().includes(b))
  ).sort((a, b) => b.tvlUsd - a.tvlUsd);

  // Advanced = higher APY, multi-asset, active protocols
  const advancedPools = allPools.filter(p => 
    p.apy > 8 && !p.stablecoin
  ).sort((a, b) => b.apy - a.apy);

  const safeApys = safePools.map(p => p.apy);
  const advApys = advancedPools.slice(0, 50).map(p => p.apy);

  return {
    safeYield: {
      name: 'Safe Yield',
      poolCount: safePools.length,
      totalTvl: safePools.reduce((s, p) => s + p.tvlUsd, 0),
      avgApy: safeApys.reduce((s, a) => s + a, 0) / (safeApys.length || 1),
      medianApy: safeApys.sort((a, b) => a - b)[Math.floor(safeApys.length / 2)] || 0,
      maxApy: Math.max(...(safeApys.length ? safeApys : [0])),
      topPools: safePools.slice(0, 10).map(p => ({
        symbol: p.symbol, project: p.project, chain: p.chain,
        tvl: p.tvlUsd, apy: p.apy, apyBase: p.apyBase || 0, apyReward: p.apyReward || 0
      })),
      riskProfile: 'Conservative — Capital preservation with stable yields',
      maxDrawdown: '~2-5%',
      rebalancing: 'Weekly'
    },
    advancedRealloc: {
      name: 'Advanced Realloc',
      poolCount: advancedPools.length,
      totalTvl: advancedPools.slice(0, 50).reduce((s, p) => s + p.tvlUsd, 0),
      avgApy: advApys.reduce((s, a) => s + a, 0) / (advApys.length || 1),
      medianApy: advApys.sort((a, b) => a - b)[Math.floor(advApys.length / 2)] || 0,
      maxApy: Math.max(...(advApys.length ? advApys : [0])),
      topPools: advancedPools.slice(0, 10).map(p => ({
        symbol: p.symbol, project: p.project, chain: p.chain,
        tvl: p.tvlUsd, apy: p.apy, apyBase: p.apyBase || 0, apyReward: p.apyReward || 0
      })),
      riskProfile: 'Dynamic — Active yield seeking across protocols',
      maxDrawdown: '~10-20%',
      rebalancing: 'Dynamic (daily)'
    },
    timestamp: Date.now()
  };
}

// ═══════════════════════════════════════════════════════════
//  AI ALLOCATION — Smart allocation suggestions
// ═══════════════════════════════════════════════════════════

async function getAllocation(params = {}) {
  const riskLevel = params.risk || 'moderate';
  const amount = parseFloat(params.amount) || 10000;

  const [poolsData, fearGreed] = await Promise.all([
    fetchJSON(`${YIELDS_BASE}/pools`, 'v_pools'),
    fetchJSON('https://api.alternative.me/fng/?limit=1', 'fng')
  ]);

  if (!poolsData?.data) return { error: 'Failed to fetch pool data' };

  const fng = fearGreed?.data?.[0]?.value || 50;
  const marketSentiment = fng < 25 ? 'fear' : fng > 75 ? 'greed' : 'neutral';

  // Select pools based on risk
  const pools = poolsData.data.filter(p => p.tvlUsd > 5_000_000 && p.apy > 0.5 && p.apy < 80);
  
  let allocations;
  if (riskLevel === 'conservative' || (riskLevel === 'moderate' && marketSentiment === 'fear')) {
    // Heavy stablecoin allocation
    const stables = pools.filter(p => p.stablecoin).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 5);
    const eth = pools.filter(p => (p.symbol || '').includes('ETH') && !p.stablecoin).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 2);
    allocations = [
      ...stables.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 30 : i === 1 ? 25 : i === 2 ? 15 : 5, type: 'stable' })),
      ...eth.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 10 : 5, type: 'eth' }))
    ];
  } else if (riskLevel === 'aggressive') {
    const highYield = pools.filter(p => p.apy > 10 && p.tvlUsd > 10_000_000).sort((a, b) => b.apy - a.apy).slice(0, 5);
    const stables = pools.filter(p => p.stablecoin).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 2);
    allocations = [
      ...highYield.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 25 : i === 1 ? 20 : 15, type: 'yield' })),
      ...stables.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 10 : 5, type: 'stable' }))
    ];
  } else {
    // Moderate — balanced
    const stables = pools.filter(p => p.stablecoin).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 3);
    const midYield = pools.filter(p => p.apy > 5 && p.apy < 25 && p.tvlUsd > 20_000_000).sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 3);
    allocations = [
      ...stables.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 25 : 15, type: 'stable' })),
      ...midYield.map((p, i) => ({ pool: p.symbol, project: p.project, chain: p.chain, apy: p.apy, tvl: p.tvlUsd, pct: i === 0 ? 20 : 10, type: 'yield' }))
    ];
  }

  // Normalize to 100%
  const totalPct = allocations.reduce((s, a) => s + a.pct, 0);
  allocations = allocations.map(a => ({ ...a, pct: Math.round(a.pct / totalPct * 100), amount: Math.round(amount * a.pct / totalPct) }));

  const weightedApy = allocations.reduce((s, a) => s + a.apy * a.pct / 100, 0);

  return {
    riskLevel,
    amount,
    marketSentiment,
    fearGreedIndex: fng,
    allocations,
    projectedApy: weightedApy,
    projectedYield: {
      daily: amount * weightedApy / 100 / 365,
      monthly: amount * weightedApy / 100 / 12,
      yearly: amount * weightedApy / 100
    },
    reasoning: `Based on ${riskLevel} risk profile and ${marketSentiment} market sentiment (FnG: ${fng}), allocating across ${allocations.length} positions.`,
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
  const params = Object.fromEntries(url.searchParams);

  try {
    let data;
    switch (action) {
      case 'overview': data = await getOverview(); break;
      case 'pools': data = await getPools(params); break;
      case 'protocols': data = await getProtocolVaults(); break;
      case 'compare': data = await compareVaults(); break;
      case 'allocate': data = await getAllocation(params); break;
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    res.status(200).json(data);
  } catch (err) {
    console.error('Vaults API error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.getOverview = getOverview;
module.exports.getPools = getPools;
module.exports.getProtocolVaults = getProtocolVaults;
module.exports.compareVaults = compareVaults;
module.exports.getAllocation = getAllocation;
