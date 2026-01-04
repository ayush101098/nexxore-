/**
 * Signals API
 * 
 * REST API for signal tracking dashboard
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  try {
    switch (action) {
      case 'stats':
        return await getStats(res);
      
      case 'signals':
        return await getSignals(req, res);
      
      case 'positions':
        return await getPositions(req, res);
      
      case 'execute':
        return await executeSignal(req, res);
      
      case 'close':
        return await closePosition(req, res);
      
      case 'performance':
        return await getPerformance(res);
      
      case 'strategy-performance':
        return await getStrategyPerformance(res);
      
      case 'protocol-performance':
        return await getProtocolPerformance(res);
      
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Get overall stats
async function getStats(res) {
  const [
    { data: portfolio },
    { data: openPositions },
    { count: activeSignals },
    { count: totalSignals }
  ] = await Promise.all([
    supabase.from('mock_portfolio').select('*').limit(1).single(),
    supabase.from('mock_positions').select('unrealized_pnl').eq('status', 'OPEN'),
    supabase.from('alpha_signals').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('alpha_signals').select('*', { count: 'exact', head: true })
  ]);

  const unrealizedPnl = (openPositions || []).reduce(
    (sum, p) => sum + parseFloat(p.unrealized_pnl || 0), 0
  );

  return res.json({
    portfolio: portfolio || { total_capital: 100000, available_capital: 100000 },
    unrealizedPnl,
    activeSignals: activeSignals || 0,
    totalSignals: totalSignals || 0,
    openPositionCount: openPositions?.length || 0
  });
}

// Get signals
async function getSignals(req, res) {
  const { status, limit = 50 } = req.query;

  let query = supabase
    .from('alpha_signals')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(parseInt(limit));

  if (status) {
    query = query.eq('status', status.toUpperCase());
  }

  const { data, error } = await query;

  if (error) throw error;
  return res.json({ signals: data || [] });
}

// Get positions
async function getPositions(req, res) {
  const { status = 'OPEN', limit = 50 } = req.query;

  const { data, error } = await supabase
    .from('mock_positions')
    .select('*')
    .eq('status', status.toUpperCase())
    .order('entry_timestamp', { ascending: false })
    .limit(parseInt(limit));

  if (error) throw error;
  return res.json({ positions: data || [] });
}

// Execute signal (for POST requests)
async function executeSignal(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { signal_id } = req.body;
  if (!signal_id) {
    return res.status(400).json({ error: 'signal_id required' });
  }

  // Get signal
  const { data: signal, error: sigError } = await supabase
    .from('alpha_signals')
    .select('*')
    .eq('signal_id', signal_id)
    .single();

  if (sigError || !signal) {
    return res.status(404).json({ error: 'Signal not found' });
  }

  // Get portfolio
  const { data: portfolio } = await supabase
    .from('mock_portfolio')
    .select('*')
    .limit(1)
    .single();

  // Calculate position size (5% of available capital)
  const positionSize = Math.min(
    parseFloat(portfolio.available_capital) * 0.05,
    10000
  );

  // Create position
  const position = {
    position_id: 'pos_' + Math.random().toString(36).substr(2, 16),
    signal_id: signal_id,
    protocol: signal.protocol,
    chain: signal.chain,
    token_symbol: signal.token_symbol,
    token_address: signal.token_address,
    position_type: 'LONG',
    entry_price: signal.entry_price || 1,
    entry_amount: positionSize,
    entry_quantity: positionSize / (signal.entry_price || 1),
    current_price: signal.entry_price || 1,
    current_value: positionSize,
    stop_loss_price: signal.stop_loss_price,
    take_profit_price: signal.target_price,
    status: 'OPEN'
  };

  const { data: newPosition, error: posError } = await supabase
    .from('mock_positions')
    .insert(position)
    .select()
    .single();

  if (posError) {
    return res.status(500).json({ error: posError.message });
  }

  // Update signal status
  await supabase
    .from('alpha_signals')
    .update({ status: 'EXECUTED' })
    .eq('signal_id', signal_id);

  // Update portfolio
  await supabase
    .from('mock_portfolio')
    .update({
      available_capital: parseFloat(portfolio.available_capital) - positionSize,
      allocated_capital: parseFloat(portfolio.allocated_capital) + positionSize,
      total_trades: portfolio.total_trades + 1
    })
    .eq('id', portfolio.id);

  return res.json({ success: true, position: newPosition });
}

// Close position
async function closePosition(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { position_id } = req.body;
  if (!position_id) {
    return res.status(400).json({ error: 'position_id required' });
  }

  // Get position
  const { data: position, error: posError } = await supabase
    .from('mock_positions')
    .select('*')
    .eq('position_id', position_id)
    .single();

  if (posError || !position) {
    return res.status(404).json({ error: 'Position not found' });
  }

  // Calculate P&L
  const entryAmount = parseFloat(position.entry_amount);
  const unrealizedPnl = parseFloat(position.unrealized_pnl || 0);
  const realizedPnl = unrealizedPnl;
  const realizedPnlPct = (realizedPnl / entryAmount) * 100;

  // Update position
  await supabase
    .from('mock_positions')
    .update({
      exit_price: position.current_price,
      exit_timestamp: new Date().toISOString(),
      exit_reason: 'MANUAL',
      realized_pnl: realizedPnl,
      realized_pnl_pct: realizedPnlPct,
      status: 'CLOSED'
    })
    .eq('position_id', position_id);

  // Update portfolio
  const { data: portfolio } = await supabase
    .from('mock_portfolio')
    .select('*')
    .limit(1)
    .single();

  const returnedCapital = entryAmount + realizedPnl;

  await supabase
    .from('mock_portfolio')
    .update({
      available_capital: parseFloat(portfolio.available_capital) + returnedCapital,
      allocated_capital: parseFloat(portfolio.allocated_capital) - entryAmount,
      total_realized_pnl: parseFloat(portfolio.total_realized_pnl) + realizedPnl,
      winning_trades: realizedPnl > 0 ? portfolio.winning_trades + 1 : portfolio.winning_trades,
      losing_trades: realizedPnl < 0 ? portfolio.losing_trades + 1 : portfolio.losing_trades
    })
    .eq('id', portfolio.id);

  return res.json({ success: true, realizedPnl, realizedPnlPct });
}

// Get performance metrics
async function getPerformance(res) {
  const { data: positions } = await supabase
    .from('mock_positions')
    .select('*')
    .eq('status', 'CLOSED');

  if (!positions || positions.length === 0) {
    return res.json({
      totalTrades: 0,
      winRate: 0,
      totalPnl: 0,
      profitFactor: 0
    });
  }

  const wins = positions.filter(p => parseFloat(p.realized_pnl) > 0);
  const losses = positions.filter(p => parseFloat(p.realized_pnl) < 0);

  const totalPnl = positions.reduce((sum, p) => sum + parseFloat(p.realized_pnl || 0), 0);
  const grossProfit = wins.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0));

  return res.json({
    totalTrades: positions.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: ((wins.length / positions.length) * 100).toFixed(1),
    totalPnl: totalPnl.toFixed(2),
    avgWin: wins.length > 0 ? (grossProfit / wins.length).toFixed(2) : 0,
    avgLoss: losses.length > 0 ? (grossLoss / losses.length).toFixed(2) : 0,
    profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'Infinity' : 0,
    bestTrade: Math.max(...positions.map(p => parseFloat(p.realized_pnl))).toFixed(2),
    worstTrade: Math.min(...positions.map(p => parseFloat(p.realized_pnl))).toFixed(2)
  });
}

// Get strategy performance
async function getStrategyPerformance(res) {
  const { data, error } = await supabase
    .from('strategy_performance')
    .select('*')
    .order('total_pnl', { ascending: false });

  if (error) throw error;
  return res.json({ strategies: data || [] });
}

// Get protocol performance
async function getProtocolPerformance(res) {
  const { data, error } = await supabase
    .from('protocol_performance')
    .select('*')
    .order('total_pnl', { ascending: false })
    .limit(10);

  if (error) throw error;
  return res.json({ protocols: data || [] });
}
