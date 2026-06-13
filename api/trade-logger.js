let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) supabase = createClient(supabaseUrl, supabaseKey);
} catch (_) {}

const memTrades = [];

async function logTrade(event) {
  const record = {
    ...event,
    wallet_address: String(event.wallet_address || '').toLowerCase(),
    created_at: new Date().toISOString()
  };
  memTrades.push(record);
  if (memTrades.length > 2000) memTrades.shift();

  if (supabase) {
    await supabase.from('perps_trades').insert({
      wallet_address: record.wallet_address || 'unknown',
      chain: record.chain || 'offchain',
      market: String(record.market || record.token_id || 'N/A').slice(0, 32),
      side: record.side || 'long',
      order_type: record.order_type || 'market',
      price: Number(record.price || 0),
      amount: Number(record.amount || record.size || 0),
      size: Number(record.size || 0),
      leverage: Number(record.leverage || 1),
      execution_status: String(record.execution_status || record.status || 'submitted').slice(0, 20),
      venue: String(record.venue || 'unknown').slice(0, 20),
      error_message: record.error_message ? String(record.error_message).slice(0, 500) : null,
      hl_response: record.raw_response ? JSON.stringify(record.raw_response).slice(0, 500) : null,
      created_at: record.created_at
    });
  }

  return record;
}

async function getTrades(walletAddress, venue) {
  const wallet = String(walletAddress || '').toLowerCase();
  if (supabase) {
    let query = supabase.from('perps_trades').select('*').eq('wallet_address', wallet).order('created_at', { ascending: false }).limit(200);
    if (venue) query = query.eq('venue', venue);
    const { data } = await query;
    return data || [];
  }
  return memTrades.filter(t => t.wallet_address === wallet && (!venue || t.venue === venue)).slice().reverse();
}

module.exports = { logTrade, getTrades };
