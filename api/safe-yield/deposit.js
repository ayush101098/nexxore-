/**
 * Safe Yield API — Deposit / Transaction Log
 * Persists vault deposit & withdrawal records to Supabase
 */
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabase();

  // ── POST — log a deposit or withdrawal ─────────────────────────────
  if (req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      await new Promise(resolve => req.on('end', resolve));

      const { userAddress, txHash, txType, amountUsdc, shares, network, blockNumber } = JSON.parse(body);

      if (!userAddress || !txHash || !txType || amountUsdc === undefined) {
        return res.status(400).json({ error: 'Required: userAddress, txHash, txType, amountUsdc' });
      }
      if (!['deposit', 'withdraw'].includes(txType)) {
        return res.status(400).json({ error: 'txType must be "deposit" or "withdraw"' });
      }

      // If Supabase is not configured, still return success for frontend flow
      if (!supabase) {
        return res.status(200).json({
          success: true,
          persisted: false,
          message: 'Transaction recorded (database not configured)',
          transaction: {
            user_address: userAddress.toLowerCase(),
            tx_hash: txHash.toLowerCase(),
            tx_type: txType,
            amount_usdc: parseFloat(amountUsdc),
            shares: shares ? parseFloat(shares) : null,
            network: network || 'ethereum',
            block_number: blockNumber || null,
            created_at: new Date().toISOString()
          }
        });
      }

      const { data, error } = await supabase
        .from('safe_yield_transactions')
        .upsert({
          user_address: userAddress.toLowerCase(),
          tx_hash:      txHash.toLowerCase(),
          tx_type:      txType,
          amount_usdc:  parseFloat(amountUsdc),
          shares:       shares ? parseFloat(shares) : null,
          network:      network || 'ethereum',
          block_number: blockNumber || null,
          created_at:   new Date().toISOString()
        }, { onConflict: 'tx_hash' })
        .select();

      if (error) throw error;

      res.status(200).json({ success: true, persisted: true, transaction: data?.[0] });
    } catch (err) {
      console.error('Deposit log error:', err.message);
      res.status(500).json({ error: 'Failed to log transaction' });
    }
    return;
  }

  // ── GET — fetch transaction history for an address ─────────────────
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const address = url.searchParams.get('address');

      if (!address) {
        return res.status(400).json({ error: 'address query parameter required' });
      }

      if (!supabase) {
        return res.status(200).json({
          transactions: [],
          summary: { totalDeposited: 0, totalWithdrawn: 0, netDeposited: 0, transactionCount: 0 },
          persisted: false
        });
      }

      const { data, error } = await supabase
        .from('safe_yield_transactions')
        .select('*')
        .eq('user_address', address.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      let totalDeposited = 0;
      let totalWithdrawn = 0;
      (data || []).forEach(tx => {
        if (tx.tx_type === 'deposit')  totalDeposited += tx.amount_usdc;
        if (tx.tx_type === 'withdraw') totalWithdrawn += tx.amount_usdc;
      });

      res.status(200).json({
        transactions: data || [],
        summary: {
          totalDeposited:   parseFloat(totalDeposited.toFixed(2)),
          totalWithdrawn:   parseFloat(totalWithdrawn.toFixed(2)),
          netDeposited:     parseFloat((totalDeposited - totalWithdrawn).toFixed(2)),
          transactionCount: (data || []).length
        }
      });
    } catch (err) {
      console.error('Transaction history error:', err.message);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
