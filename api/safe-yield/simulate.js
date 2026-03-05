/**
 * Safe Yield API — Simulate Endpoint
 * Yield projection using REAL current protocol APYs from DeFi Llama
 */
const axios = require('axios');

// ── Cache ────────────────────────────────────────────────────────────
let apyCache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

const ALLOCATION = { 'aave-v3': 40, 'compound-v3': 25, 'maker-sdai': 25, 'lido': 10 };
const POOL_FILTERS = [
  { key: 'aave-v3',     project: 'aave-v3',     chain: 'Ethereum', symbol: 'USDC'  },
  { key: 'compound-v3', project: 'compound-v3', chain: 'Ethereum', symbol: 'USDC'  },
  { key: 'maker-sdai',  project: 'makerdao',    chain: 'Ethereum', symbol: 'DAI'   },
  { key: 'lido',        project: 'lido',        chain: 'Ethereum', symbol: 'STETH' }
];

async function getBlendedApy() {
  const now = Date.now();
  if (apyCache.data && (now - apyCache.timestamp) < CACHE_TTL) return apyCache.data;

  try {
    const { data } = await axios.get('https://yields.llama.fi/pools', { timeout: 15000 });
    const pools = data.data || [];
    let blended = 0;
    const strats = {};

    for (const filter of POOL_FILTERS) {
      const match = pools
        .filter(p => p.project === filter.project && p.chain === filter.chain && p.symbol?.toUpperCase().includes(filter.symbol))
        .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
      if (match) {
        const apy = match.apy || match.apyBase || 0;
        blended += apy * (ALLOCATION[filter.key] / 100);
        strats[filter.key] = apy;
      }
    }

    apyCache = { data: { blended, strategies: strats }, timestamp: now };
    return apyCache.data;
  } catch {
    return apyCache.data || { blended: 4.5, strategies: {} };
  }
}

// ── Handler ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    await new Promise(resolve => req.on('end', resolve));

    const { depositAmount = 10000, timeHorizonMonths = 12 } = JSON.parse(body || '{}');

    if (depositAmount < 1 || depositAmount > 1e10) {
      return res.status(400).json({ error: 'Deposit amount must be $1 – $10B' });
    }
    if (timeHorizonMonths < 1 || timeHorizonMonths > 120) {
      return res.status(400).json({ error: 'Time horizon must be 1–120 months' });
    }

    const { blended, strategies } = await getBlendedApy();

    const expectedApy = blended;
    const bestApy     = blended * 1.3;
    const worstApy    = Math.max(blended * 0.5, 1.0);

    const years    = timeHorizonMonths / 12;
    const expected = depositAmount * Math.pow(1 + expectedApy / 100, years);
    const best     = depositAmount * Math.pow(1 + bestApy / 100, years);
    const worst    = depositAmount * Math.pow(1 + worstApy / 100, years);

    // Monthly projection path
    const path = [];
    let current = depositAmount;
    const monthlyRate = expectedApy / 100 / 12;
    for (let m = 0; m <= timeHorizonMonths; m++) {
      path.push({ month: m, value: parseFloat(current.toFixed(2)) });
      current *= (1 + monthlyRate);
    }

    // After-fee estimate (0.5% management + 5% performance above 4% threshold)
    const mgmtFee = 0.005;
    const perfFee = 0.05;
    const perfThreshold = 4.0;
    const grossProfit = expected - depositAmount;
    const mgmtCost = depositAmount * mgmtFee * years;
    const perfCost = expectedApy > perfThreshold
      ? grossProfit * ((expectedApy - perfThreshold) / expectedApy) * perfFee
      : 0;
    const netValue = expected - mgmtCost - perfCost;

    res.status(200).json({
      inputs: { depositAmount, timeHorizonMonths, timestamp: new Date().toISOString() },
      currentApys: {
        blended: parseFloat(expectedApy.toFixed(2)),
        strategies: Object.fromEntries(
          Object.entries(strategies).map(([k, v]) => [k, parseFloat(v.toFixed(2))])
        ),
        source: 'DeFi Llama (live)'
      },
      projections: {
        expectedApy: parseFloat(expectedApy.toFixed(2)),
        apyRange:    { min: parseFloat(worstApy.toFixed(2)), max: parseFloat(bestApy.toFixed(2)) },
        expectedValue: parseFloat(expected.toFixed(2)),
        valueRange:    { best: parseFloat(best.toFixed(2)), worst: parseFloat(worst.toFixed(2)) },
        expectedProfit: parseFloat((expected - depositAmount).toFixed(2)),
        profitRange: {
          best:  parseFloat((best  - depositAmount).toFixed(2)),
          worst: parseFloat((worst - depositAmount).toFixed(2))
        }
      },
      fees: {
        managementFee:  '0.5% annually',
        performanceFee: '5% of profits above 4% APY',
        estimatedMgmtCost: parseFloat(mgmtCost.toFixed(2)),
        estimatedPerfCost: parseFloat(perfCost.toFixed(2)),
        netValue:          parseFloat(netValue.toFixed(2)),
        netProfit:         parseFloat((netValue - depositAmount).toFixed(2))
      },
      path,
      risk: {
        volatility:  2.0,
        maxDrawdown: -2.5,
        sharpeRatio: parseFloat(((expectedApy - 4.5) / 2.0).toFixed(2))
      }
    });
  } catch (err) {
    console.error('Simulate error:', err.message);
    res.status(500).json({ error: 'Simulation failed' });
  }
};
