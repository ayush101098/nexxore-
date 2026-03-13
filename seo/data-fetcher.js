/**
 * pSEO Data Fetcher
 *
 * Pulls live on-chain data from free APIs and caches results to disk.
 * Falls back to realistic mock data when API keys are unavailable or
 * rate-limited, so the generator always produces usable pages.
 *
 * Data sources:
 *   CoinGecko   — price, market cap, volume
 *   DeFiLlama   — TVL, yields, protocol metadata
 *   CoinGlass   — funding rates, OI, liquidations  (API key optional)
 *   Fallback    — deterministic mock data seeded from token/protocol name
 */

const fs = require('fs');
const path = require('path');
const { dataRefresh } = require('./config');

const CACHE_DIR = path.join(__dirname, dataRefresh.cacheDirName);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheGet(key, maxAgeMs) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return null; }
}

function cacheSet(key, data) {
  ensureCacheDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** Deterministic seed for reproducible mock data */
function hashSeed(str) {
  let h = 0;
  for (const c of str) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ─── CoinGecko: price + market data ─────────────────────────────────────────

async function fetchCoinGeckoData(coingeckoId) {
  const cacheKey = `cg_${coingeckoId}`;
  const cached = cacheGet(cacheKey, dataRefresh.priceDataIntervalMs);
  if (cached) return cached;

  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${coingeckoId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    const result = {
      price: data.market_data?.current_price?.usd ?? 0,
      marketCap: data.market_data?.market_cap?.usd ?? 0,
      volume24h: data.market_data?.total_volume?.usd ?? 0,
      priceChange24h: data.market_data?.price_change_percentage_24h ?? 0,
      priceChange7d: data.market_data?.price_change_percentage_7d ?? 0,
      ath: data.market_data?.ath?.usd ?? 0,
      athChangePercent: data.market_data?.ath_change_percentage?.usd ?? 0,
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`  ⚠ CoinGecko miss for ${coingeckoId}: ${err.message}`);
    return mockCoinGeckoData(coingeckoId);
  }
}

function mockCoinGeckoData(id) {
  const s = hashSeed(id);
  return {
    price: +(((s % 9000) + 100) / 100).toFixed(2),
    marketCap: (s % 50 + 1) * 1e8,
    volume24h: (s % 20 + 1) * 1e7,
    priceChange24h: +((s % 200 - 100) / 10).toFixed(1),
    priceChange7d: +((s % 300 - 150) / 10).toFixed(1),
    ath: +(((s % 9000) + 200) / 50).toFixed(2),
    athChangePercent: -(s % 80),
  };
}

// ─── DeFiLlama: TVL + yields ─────────────────────────────────────────────────

async function fetchDefiLlamaProtocol(defillamaId) {
  const cacheKey = `dll_${defillamaId}`;
  const cached = cacheGet(cacheKey, dataRefresh.defiMetricsIntervalMs);
  if (cached) return cached;

  try {
    const data = await fetchJson(`https://api.llama.fi/protocol/${defillamaId}`);
    const tvlHistory = (data.tvl || []).slice(-8); // last 8 data-points
    const currentTvl = tvlHistory.length ? tvlHistory[tvlHistory.length - 1].totalLiquidityUSD : 0;
    const prevTvl = tvlHistory.length > 7 ? tvlHistory[0].totalLiquidityUSD : currentTvl;
    const tvlChange7d = prevTvl ? +((currentTvl - prevTvl) / prevTvl * 100).toFixed(1) : 0;

    const result = {
      tvl: currentTvl,
      tvlChange7d,
      chains: data.chains || [],
      category: data.category || 'DeFi',
      description: data.description || '',
      audits: data.audits ? data.audits.length : 0,
      gecko_id: data.gecko_id || null,
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`  ⚠ DeFiLlama miss for ${defillamaId}: ${err.message}`);
    return mockDefiLlamaData(defillamaId);
  }
}

function mockDefiLlamaData(id) {
  const s = hashSeed(id);
  return {
    tvl: (s % 100 + 1) * 1e7,
    tvlChange7d: +((s % 200 - 100) / 10).toFixed(1),
    chains: ['Ethereum'],
    category: 'Lending',
    description: `${id} is a decentralised finance protocol.`,
    audits: (s % 3) + 1,
    gecko_id: null,
  };
}

/** Fetch top yield pools from DeFiLlama for a protocol */
async function fetchDefiLlamaYields(protocolSlug) {
  const cacheKey = `dll_yields_${protocolSlug}`;
  const cached = cacheGet(cacheKey, dataRefresh.defiMetricsIntervalMs);
  if (cached) return cached;

  try {
    const data = await fetchJson('https://yields.llama.fi/pools');
    const pools = (data.data || [])
      .filter(p => (p.project || '').toLowerCase().includes(protocolSlug.toLowerCase()))
      .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
      .slice(0, 12)
      .map(p => ({
        pool: p.symbol || 'Unknown',
        chain: p.chain || 'Unknown',
        apy: +(p.apy || 0).toFixed(2),
        tvl: p.tvlUsd || 0,
        apyBase: +(p.apyBase || 0).toFixed(2),
        apyReward: +(p.apyReward || 0).toFixed(2),
        stablecoin: p.stablecoin || false,
      }));

    cacheSet(cacheKey, pools);
    return pools;
  } catch (err) {
    console.warn(`  ⚠ DeFiLlama yields miss for ${protocolSlug}: ${err.message}`);
    return mockYieldPools(protocolSlug);
  }
}

function mockYieldPools(slug) {
  const s = hashSeed(slug);
  return [
    { pool: 'ETH-USDC',  chain: 'Ethereum', apy: +((s % 800 + 200) / 100).toFixed(2), tvl: (s % 50 + 5) * 1e6, stablecoin: false },
    { pool: 'USDC-USDT',  chain: 'Ethereum', apy: +((s % 500 + 100) / 100).toFixed(2), tvl: (s % 30 + 3) * 1e6, stablecoin: true },
    { pool: 'WBTC-ETH',   chain: 'Arbitrum', apy: +((s % 600 + 150) / 100).toFixed(2), tvl: (s % 20 + 2) * 1e6, stablecoin: false },
  ];
}

// ─── Funding Rates (CoinGlass-style or mock) ────────────────────────────────

async function fetchFundingRates(symbol) {
  const cacheKey = `funding_${symbol}`;
  const cached = cacheGet(cacheKey, dataRefresh.fundingRateIntervalMs);
  if (cached) return cached;

  // CoinGlass requires an API key; try public endpoint first, then mock
  try {
    // Try Binance public endpoint for funding rate
    const data = await fetchJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}USDT&limit=30`
    );
    if (data && data.length) {
      const rates = data.map(d => ({
        time: d.fundingTime,
        rate: +d.fundingRate,
      }));
      const current = rates[rates.length - 1].rate;
      const avg7d = +(rates.slice(-21).reduce((s, r) => s + r.rate, 0) / Math.min(rates.length, 21)).toFixed(6);
      const avg30d = +(rates.reduce((s, r) => s + r.rate, 0) / rates.length).toFixed(6);

      const result = { current, avg7d, avg30d, history: rates, source: 'binance' };
      cacheSet(cacheKey, result);
      return result;
    }
  } catch { /* fall through */ }

  return mockFundingRates(symbol);
}

function mockFundingRates(symbol) {
  const s = hashSeed(symbol);
  const base = ((s % 200) - 80) / 100000; // between -0.0008 and +0.0012
  return {
    current: +base.toFixed(6),
    avg7d: +(base * 0.9).toFixed(6),
    avg30d: +(base * 0.85).toFixed(6),
    history: [],
    source: 'mock',
  };
}

// ─── Open Interest & Liquidations (mock-heavy — real data needs paid APIs) ──

async function fetchOIData(symbol) {
  const cacheKey = `oi_${symbol}`;
  const cached = cacheGet(cacheKey, dataRefresh.fundingRateIntervalMs);
  if (cached) return cached;

  // Real API would go here (CoinGlass / Coinalyze — both paid)
  return mockOIData(symbol);
}

function mockOIData(symbol) {
  const s = hashSeed(symbol);
  const oiBase = (s % 40 + 2) * 1e8; // $200M–$4.2B
  return {
    openInterest: oiBase,
    oiChange24h: +((s % 200 - 100) / 10).toFixed(1),
    volume24h: oiBase * ((s % 30 + 10) / 10),
    longShortRatio: +(0.7 + (s % 60) / 100).toFixed(2),
    liquidations24h: oiBase * ((s % 5 + 1) / 100),
    liquidationLongs: oiBase * ((s % 3 + 1) / 100),
    liquidationShorts: oiBase * ((s % 2 + 1) / 100),
    riskScore: Math.min(10, Math.max(1, Math.round(2 + (s % 7)))),
    exchanges: [
      { name: 'Binance',      oi: oiBase * 0.35, type: 'cefi' },
      { name: 'Bybit',        oi: oiBase * 0.20, type: 'cefi' },
      { name: 'OKX',          oi: oiBase * 0.15, type: 'cefi' },
      { name: 'dYdX',         oi: oiBase * 0.10, type: 'defi' },
      { name: 'Hyperliquid',  oi: oiBase * 0.12, type: 'defi' },
      { name: 'GMX',          oi: oiBase * 0.08, type: 'defi' },
    ],
  };
}

// ─── Stablecoin Yield Matrix (DeFiLlama yields filtered by stablecoin) ──────

async function fetchStablecoinYields() {
  const cacheKey = 'stablecoin_yields_matrix';
  const cached = cacheGet(cacheKey, dataRefresh.defiMetricsIntervalMs);
  if (cached) return cached;

  try {
    const data = await fetchJson('https://yields.llama.fi/pools');
    const stables = ['usdc', 'usdt', 'dai', 'usde', 'crvusd', 'gho', 'frax', 'lusd', 'sdai', 'usdm', 'usdy', 'pyusd'];
    const protocols = ['aave', 'compound', 'morpho', 'curve', 'pendle'];

    const matrix = {};
    for (const stable of stables) {
      matrix[stable.toUpperCase()] = {};
      for (const proto of protocols) {
        const match = (data.data || []).find(p =>
          (p.symbol || '').toLowerCase().includes(stable) &&
          (p.project || '').toLowerCase().includes(proto)
        );
        matrix[stable.toUpperCase()][proto] = match ? +(match.apy || 0).toFixed(2) : null;
      }
    }
    cacheSet(cacheKey, matrix);
    return matrix;
  } catch (err) {
    console.warn(`  ⚠ Stablecoin yield matrix miss: ${err.message}`);
    return mockStablecoinYields();
  }
}

function mockStablecoinYields() {
  const stables = ['USDC','USDT','DAI','USDe','crvUSD','GHO','FRAX','LUSD','sDAI','USDM','USDY','PYUSD'];
  const matrix = {};
  for (const s of stables) {
    const seed = hashSeed(s);
    matrix[s] = {
      aave: +((seed % 400 + 150) / 100).toFixed(2),
      compound: +((seed % 350 + 120) / 100).toFixed(2),
      morpho: +((seed % 500 + 200) / 100).toFixed(2),
      curve: +((seed % 600 + 250) / 100).toFixed(2),
      pendle: +((seed % 800 + 300) / 100).toFixed(2),
    };
  }
  return matrix;
}

// ─── Export ──────────────────────────────────────────────────────────────────

module.exports = {
  fetchCoinGeckoData,
  fetchDefiLlamaProtocol,
  fetchDefiLlamaYields,
  fetchFundingRates,
  fetchOIData,
  fetchStablecoinYields,
  // utilities
  cacheGet,
  cacheSet,
  ensureCacheDir,
};
