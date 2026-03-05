/**
 * Safe Yield API — Strategies Endpoint
 * Returns strategy definitions enriched with REAL APY data from DeFi Llama
 */
const axios = require('axios');

// ── Cache (5 min) ────────────────────────────────────────────────────
let poolCache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

// ── Risk weights ─────────────────────────────────────────────────────
const RISK_WEIGHTS = {
  protocol:    0.25,
  liquidity:   0.20,
  utilization: 0.25,
  governance:  0.15,
  oracle:      0.15
};

function calcRisk(c) {
  return Object.keys(RISK_WEIGHTS).reduce((s, k) => s + (c[k] || 0) * RISK_WEIGHTS[k], 0);
}
function riskLevel(score) {
  if (score < 0.15) return 'very-low';
  if (score < 0.30) return 'low';
  if (score < 0.45) return 'medium';
  if (score < 0.60) return 'elevated';
  if (score < 0.75) return 'high';
  return 'critical';
}

async function fetchPools() {
  const now = Date.now();
  if (poolCache.data && (now - poolCache.timestamp) < CACHE_TTL) return poolCache.data;
  try {
    const { data } = await axios.get('https://yields.llama.fi/pools', { timeout: 15000 });
    poolCache = { data: data.data || [], timestamp: now };
    return poolCache.data;
  } catch {
    return poolCache.data || [];
  }
}

function findPool(pools, project, chain, symbol) {
  return pools
    .filter(p => p.project === project && p.chain === chain && p.symbol?.toUpperCase().includes(symbol))
    .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0] || null;
}

function fmtUsd(v) {
  if (!v && v !== 0) return '$—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

// ── Strategy definitions ─────────────────────────────────────────────
const STRATEGIES = [
  {
    id: 'aave-v3',
    name: 'Aave V3 Lending',
    description: 'USDC supply on Aave V3 — the largest DeFi lending protocol',
    icon: '🏦',
    color: '#6366f1',
    allocationTarget: 40,
    defiLlama: { project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC' },
    riskComponents: { protocol: 0.08, liquidity: 0.10, utilization: 0.15, governance: 0.06, oracle: 0.04 },
    details: {
      whyExists: 'Aave V3 is the largest DeFi lending protocol with $10B+ TVL, 15+ audits, and zero exploits on V3. USDC supply earns variable yield from borrower interest payments.',
      whatCanGoWrong: 'Smart contract bug, oracle manipulation, extreme utilization spike preventing withdrawals, USDC de-peg event.',
      systemResponse: 'Utilization monitoring at 80%. Gradual exit begins at 90%. Full exit on USDC deviation >0.5%. Rebalancing freezes above 0.6 risk score.'
    }
  },
  {
    id: 'compound-v3',
    name: 'Compound V3 Lending',
    description: 'USDC supply on Compound V3 — battle-tested since 2018',
    icon: '🔷',
    color: '#00d395',
    allocationTarget: 25,
    defiLlama: { project: 'compound-v3', chain: 'Ethereum', symbol: 'USDC' },
    riskComponents: { protocol: 0.10, liquidity: 0.12, utilization: 0.18, governance: 0.08, oracle: 0.05 },
    details: {
      whyExists: 'Compound pioneered DeFi lending. V3 (Comet) uses isolated single-asset markets — simpler, more gas-efficient, harder to exploit. COMP rewards may add extra yield.',
      whatCanGoWrong: 'Governance risk (2020 oracle incident). V3 mitigates with isolated markets. Interest rate spikes during high utilization. Smart contract bug.',
      systemResponse: 'Governance vote monitoring with 48h advance alerts. Exit triggers if utilization exceeds 92% for 4 hours. Hard stop on any oracle anomaly.'
    }
  },
  {
    id: 'maker-sdai',
    name: 'MakerDAO / sDAI',
    description: 'DAI Savings Rate — yield backed by Maker protocol revenue',
    icon: '💎',
    color: '#22c55e',
    allocationTarget: 25,
    defiLlama: { project: 'makerdao', chain: 'Ethereum', symbol: 'DAI' },
    riskComponents: { protocol: 0.05, liquidity: 0.06, utilization: 0.02, governance: 0.12, oracle: 0.03 },
    details: {
      whyExists: 'The DSR via sDAI is one of the safest DeFi yields. Backed by Maker\'s $8B+ collateral base including US Treasuries. Yield from protocol revenue, not speculation.',
      whatCanGoWrong: 'DAI de-peg event, governance voting DSR to 0%, smart contract risk in sDAI wrapper, systemic risk from RWA collateral.',
      systemResponse: 'DAI price monitoring at ±0.5% deviation. Automatic reduction at ±1%. Full exit at ±2%. Governance DSR change alerts 24h in advance.'
    }
  },
  {
    id: 'lido',
    name: 'Lido stETH',
    description: 'Ethereum staking yield — consensus rewards from PoS validation',
    icon: '🔴',
    color: '#f59e0b',
    allocationTarget: 10,
    defiLlama: { project: 'lido', chain: 'Ethereum', symbol: 'STETH' },
    riskComponents: { protocol: 0.07, liquidity: 0.15, utilization: 0.05, governance: 0.10, oracle: 0.08 },
    details: {
      whyExists: 'Lido holds 28%+ of all staked ETH. The ~3.5% APR comes from Ethereum PoS consensus rewards — the most fundamental yield in crypto.',
      whatCanGoWrong: 'stETH/ETH de-peg (briefly in 2022), validator slashing, Lido smart contract vulnerability, ETH price exposure (mitigated by small allocation).',
      systemResponse: 'stETH/ETH ratio monitoring. Alert at 0.5% deviation, reduction at 1%, exit at 2%. 10% allocation cap limits exposure. Slashing insurance monitored.'
    }
  }
];

// ── Handler ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const pools = await fetchPools();

    const strategies = STRATEGIES.map(strategy => {
      const { defiLlama } = strategy;
      const pool = findPool(pools, defiLlama.project, defiLlama.chain, defiLlama.symbol);
      const risk = calcRisk(strategy.riskComponents);

      return {
        ...strategy,
        liveMetrics: pool ? {
          apy:          parseFloat((pool.apy       || 0).toFixed(2)),
          apyBase:      parseFloat((pool.apyBase   || 0).toFixed(2)),
          apyReward:    parseFloat((pool.apyReward || 0).toFixed(2)),
          tvl:          pool.tvlUsd || 0,
          tvlFormatted: fmtUsd(pool.tvlUsd),
          apyChange1d:  pool.apyPct1D  ? parseFloat(pool.apyPct1D.toFixed(2))  : null,
          apyChange7d:  pool.apyPct7D  ? parseFloat(pool.apyPct7D.toFixed(2))  : null,
          apyChange30d: pool.apyPct30D ? parseFloat(pool.apyPct30D.toFixed(2)) : null,
          poolId:       pool.pool
        } : null,
        riskScore: parseFloat(risk.toFixed(3)),
        riskLevel: riskLevel(risk)
      };
    });

    res.status(200).json({
      strategies,
      meta: {
        count:     strategies.length,
        liveCount: strategies.filter(s => s.liveMetrics).length,
        weights:   RISK_WEIGHTS,
        source:    'DeFi Llama',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Strategies error:', err.message);
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
};
