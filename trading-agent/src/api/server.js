// Dashboard API Server - REST API for monitoring and control
import express from 'express';
import cors from 'cors';
import db from './data/database.js';
import config from './config.js';

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Get portfolio summary
app.get('/api/portfolio', (req, res) => {
  try {
    const portfolio = db.prepare(`
      SELECT * FROM portfolio ORDER BY updated_at DESC LIMIT 1
    `).get();

    const openPositions = db.prepare(`
      SELECT * FROM positions WHERE status = 'OPEN'
    `).all();

    res.json({
      success: true,
      data: {
        ...portfolio,
        openPositions: openPositions.length,
        positions: openPositions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get open positions
app.get('/api/positions', (req, res) => {
  try {
    const positions = db.prepare(`
      SELECT * FROM positions WHERE status = 'OPEN' ORDER BY created_at DESC
    `).all();

    res.json({ success: true, data: positions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trade history
app.get('/api/trades', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const trades = db.prepare(`
      SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?
    `).all(limit);

    res.json({ success: true, data: trades });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get signals
app.get('/api/signals', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const signals = db.prepare(`
      SELECT * FROM signals ORDER BY created_at DESC LIMIT ?
    `).all(limit);

    res.json({ success: true, data: signals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get performance stats
app.get('/api/performance', (req, res) => {
  try {
    const trades = db.prepare(`SELECT * FROM trades WHERE status = 'CLOSED'`).all();
    
    if (trades.length === 0) {
      return res.json({
        success: true,
        data: {
          totalTrades: 0,
          winRate: 0,
          totalPnl: 0,
          profitFactor: 0
        }
      });
    }

    const winners = trades.filter(t => t.pnl > 0);
    const losers = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));

    // Calculate streak
    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLoseStreak = 0;
    
    for (const trade of trades.reverse()) {
      if (trade.pnl > 0) {
        if (currentStreak >= 0) currentStreak++;
        else currentStreak = 1;
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        if (currentStreak <= 0) currentStreak--;
        else currentStreak = -1;
        maxLoseStreak = Math.max(maxLoseStreak, Math.abs(currentStreak));
      }
    }

    res.json({
      success: true,
      data: {
        totalTrades: trades.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate: ((winners.length / trades.length) * 100).toFixed(1),
        avgWin: winners.length > 0 ? (grossProfit / winners.length).toFixed(2) : 0,
        avgLoss: losers.length > 0 ? (grossLoss / losers.length).toFixed(2) : 0,
        totalPnl: totalPnl.toFixed(2),
        profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'Infinite',
        largestWin: Math.max(...trades.map(t => t.pnl)).toFixed(2),
        largestLoss: Math.min(...trades.map(t => t.pnl)).toFixed(2),
        maxWinStreak,
        maxLoseStreak,
        avgRiskReward: (trades.reduce((sum, t) => sum + (t.pnl_percent / (t.stop_loss ? Math.abs((t.entry_price - t.stop_loss) / t.entry_price * 100) : 2)), 0) / trades.length).toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get daily metrics
app.get('/api/metrics/daily', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const metrics = db.prepare(`
      SELECT * FROM daily_metrics ORDER BY date DESC LIMIT ?
    `).all(days);

    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get event log
app.get('/api/events', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type;

    let query = 'SELECT * FROM event_log';
    let params = [];

    if (type) {
      query += ' WHERE event_type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const events = db.prepare(query).all(...params);

    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get configuration
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      mode: config.mode,
      assets: config.assets,
      risk: config.risk,
      signals: config.signals
    }
  });
});

// Equity curve data
app.get('/api/equity-curve', (req, res) => {
  try {
    const trades = db.prepare(`
      SELECT closed_at, pnl FROM trades WHERE status = 'CLOSED' ORDER BY closed_at ASC
    `).all();

    let equity = 10000; // Starting capital
    const curve = [{ date: 'Start', equity }];

    for (const trade of trades) {
      equity += trade.pnl;
      curve.push({
        date: trade.closed_at,
        equity: equity.toFixed(2)
      });
    }

    res.json({ success: true, data: curve });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
const PORT = process.env.DASHBOARD_PORT || 3001;

export function startDashboardServer() {
  app.listen(PORT, () => {
    console.log(`📊 Dashboard API running on http://localhost:${PORT}`);
  });
  return app;
}

export default app;
