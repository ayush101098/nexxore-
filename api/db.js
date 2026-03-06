/**
 * Database Layer — Supabase Client + Schema Management
 * ═══════════════════════════════════════════════════════
 * 
 * Provides persistent storage for:
 *   - User watchlists & portfolio tracking
 *   - Strategy saves & backtest history
 *   - Trade log history
 *   - Alert configurations
 *
 * Endpoints:
 *   GET  /api/db?action=watchlist&wallet=X            → Get user watchlist
 *   POST /api/db?action=watchlist  { wallet, tokens }  → Save watchlist
 *   GET  /api/db?action=trades&wallet=X               → Get trade history
 *   POST /api/db?action=trade  { wallet, trade }       → Log a trade
 *   GET  /api/db?action=strategies&wallet=X            → Get saved strategies
 *   POST /api/db?action=strategy  { wallet, strategy } → Save a strategy
 *   GET  /api/db?action=portfolio&wallet=X             → Get portfolio state
 *   POST /api/db?action=portfolio  { wallet, portfolio }→ Save portfolio
 */

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;
  
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  
  if (!url || !key) {
    console.warn('Supabase env vars not set — using local storage fallback');
    return null;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key);
    return supabase;
  } catch (e) {
    console.error('Failed to init Supabase:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  IN-MEMORY FALLBACK (when Supabase is not configured)
// ═══════════════════════════════════════════════════════════

const memStore = {
  watchlists: new Map(),
  trades: new Map(),
  strategies: new Map(),
  portfolios: new Map()
};

// ═══════════════════════════════════════════════════════════
//  WATCHLIST
// ═══════════════════════════════════════════════════════════

async function getWatchlist(wallet) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('watchlists').select('*').eq('wallet', wallet.toLowerCase());
    if (error) throw error;
    return data || [];
  }
  return memStore.watchlists.get(wallet.toLowerCase()) || [];
}

async function saveWatchlist(wallet, tokens) {
  const sb = getSupabase();
  const record = { wallet: wallet.toLowerCase(), tokens, updated_at: new Date().toISOString() };
  
  if (sb) {
    const { data, error } = await sb.from('watchlists').upsert(record, { onConflict: 'wallet' });
    if (error) throw error;
    return data;
  }
  memStore.watchlists.set(wallet.toLowerCase(), record);
  return record;
}

// ═══════════════════════════════════════════════════════════
//  TRADES
// ═══════════════════════════════════════════════════════════

async function getTrades(wallet, limit = 50) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('trades').select('*').eq('wallet', wallet.toLowerCase()).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }
  const trades = memStore.trades.get(wallet.toLowerCase()) || [];
  return trades.slice(-limit).reverse();
}

async function logTrade(wallet, trade) {
  const sb = getSupabase();
  const record = {
    wallet: wallet.toLowerCase(),
    pair: trade.pair,
    side: trade.side,
    size: trade.size,
    price: trade.price,
    leverage: trade.leverage || 1,
    pnl: trade.pnl || 0,
    fees: trade.fees || 0,
    exchange: trade.exchange || 'hyperliquid',
    created_at: new Date().toISOString()
  };

  if (sb) {
    const { data, error } = await sb.from('trades').insert(record);
    if (error) throw error;
    return data;
  }
  if (!memStore.trades.has(wallet.toLowerCase())) memStore.trades.set(wallet.toLowerCase(), []);
  memStore.trades.get(wallet.toLowerCase()).push(record);
  return record;
}

// ═══════════════════════════════════════════════════════════
//  STRATEGIES
// ═══════════════════════════════════════════════════════════

async function getStrategies(wallet) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('strategies').select('*').eq('wallet', wallet.toLowerCase()).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return memStore.strategies.get(wallet.toLowerCase()) || [];
}

async function saveStrategy(wallet, strategy) {
  const sb = getSupabase();
  const record = {
    wallet: wallet.toLowerCase(),
    name: strategy.name,
    type: strategy.type,
    allocations: strategy.allocations,
    backtest_results: strategy.backtestResults || null,
    risk_level: strategy.riskLevel || 'moderate',
    created_at: new Date().toISOString()
  };

  if (sb) {
    const { data, error } = await sb.from('strategies').insert(record);
    if (error) throw error;
    return data;
  }
  if (!memStore.strategies.has(wallet.toLowerCase())) memStore.strategies.set(wallet.toLowerCase(), []);
  memStore.strategies.get(wallet.toLowerCase()).push(record);
  return record;
}

// ═══════════════════════════════════════════════════════════
//  PORTFOLIO
// ═══════════════════════════════════════════════════════════

async function getPortfolio(wallet) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('portfolios').select('*').eq('wallet', wallet.toLowerCase()).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }
  return memStore.portfolios.get(wallet.toLowerCase()) || null;
}

async function savePortfolio(wallet, portfolio) {
  const sb = getSupabase();
  const record = {
    wallet: wallet.toLowerCase(),
    positions: portfolio.positions || [],
    total_value: portfolio.totalValue || 0,
    pnl_total: portfolio.pnlTotal || 0,
    updated_at: new Date().toISOString()
  };

  if (sb) {
    const { data, error } = await sb.from('portfolios').upsert(record, { onConflict: 'wallet' });
    if (error) throw error;
    return data;
  }
  memStore.portfolios.set(wallet.toLowerCase(), record);
  return record;
}

// ═══════════════════════════════════════════════════════════
//  SCHEMA MIGRATION (call once to set up tables)
// ═══════════════════════════════════════════════════════════

async function migrate() {
  const sb = getSupabase();
  if (!sb) return { status: 'skipped', reason: 'Supabase not configured' };

  const tables = [
    `CREATE TABLE IF NOT EXISTS watchlists (
      id SERIAL PRIMARY KEY,
      wallet TEXT UNIQUE NOT NULL,
      tokens JSONB DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      pair TEXT,
      side TEXT,
      size NUMERIC,
      price NUMERIC,
      leverage NUMERIC DEFAULT 1,
      pnl NUMERIC DEFAULT 0,
      fees NUMERIC DEFAULT 0,
      exchange TEXT DEFAULT 'hyperliquid',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS strategies (
      id SERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      name TEXT,
      type TEXT,
      allocations JSONB,
      backtest_results JSONB,
      risk_level TEXT DEFAULT 'moderate',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS portfolios (
      id SERIAL PRIMARY KEY,
      wallet TEXT UNIQUE NOT NULL,
      positions JSONB DEFAULT '[]',
      total_value NUMERIC DEFAULT 0,
      pnl_total NUMERIC DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  ];

  const results = [];
  for (const sql of tables) {
    const { error } = await sb.rpc('exec_sql', { sql_text: sql }).catch(() => ({ error: 'RPC not available' }));
    results.push({ sql: sql.slice(0, 60) + '...', error: error || null });
  }
  return { status: 'completed', results };
}

// ═══════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || (req.body?.action);
  const wallet = url.searchParams.get('wallet') || req.body?.wallet;

  try {
    switch (action) {
      case 'watchlist':
        if (req.method === 'POST') {
          if (!wallet || !req.body?.tokens) return res.status(400).json({ error: 'wallet and tokens required' });
          return res.json(await saveWatchlist(wallet, req.body.tokens));
        }
        if (!wallet) return res.status(400).json({ error: 'wallet param required' });
        return res.json(await getWatchlist(wallet));

      case 'trades':
        if (!wallet) return res.status(400).json({ error: 'wallet param required' });
        return res.json(await getTrades(wallet));

      case 'trade':
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        if (!wallet || !req.body?.trade) return res.status(400).json({ error: 'wallet and trade required' });
        return res.json(await logTrade(wallet, req.body.trade));

      case 'strategies':
        if (!wallet) return res.status(400).json({ error: 'wallet param required' });
        return res.json(await getStrategies(wallet));

      case 'strategy':
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        if (!wallet || !req.body?.strategy) return res.status(400).json({ error: 'wallet and strategy required' });
        return res.json(await saveStrategy(wallet, req.body.strategy));

      case 'portfolio':
        if (req.method === 'POST') {
          if (!wallet || !req.body?.portfolio) return res.status(400).json({ error: 'wallet and portfolio required' });
          return res.json(await savePortfolio(wallet, req.body.portfolio));
        }
        if (!wallet) return res.status(400).json({ error: 'wallet param required' });
        return res.json(await getPortfolio(wallet));

      case 'migrate':
        return res.json(await migrate());

      case 'status':
        return res.json({ 
          supabase: !!getSupabase(), 
          fallback: !getSupabase() ? 'in-memory' : 'none',
          memStore: {
            watchlists: memStore.watchlists.size,
            trades: memStore.trades.size,
            strategies: memStore.strategies.size,
            portfolios: memStore.portfolios.size
          }
        });

      default:
        return res.status(400).json({ error: 'Unknown action. Use: watchlist, trades, trade, strategies, strategy, portfolio, migrate, status' });
    }
  } catch (err) {
    console.error('DB API error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Export for use by other modules
module.exports.getWatchlist = getWatchlist;
module.exports.saveWatchlist = saveWatchlist;
module.exports.getTrades = getTrades;
module.exports.logTrade = logTrade;
module.exports.getStrategies = getStrategies;
module.exports.saveStrategy = saveStrategy;
module.exports.getPortfolio = getPortfolio;
module.exports.savePortfolio = savePortfolio;
