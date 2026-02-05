// Database setup and migrations
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, 'trading.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
const createTables = () => {
  // Trades table - stores all executed trades
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT UNIQUE NOT NULL,
      asset TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
      entry_price REAL NOT NULL,
      exit_price REAL,
      size REAL NOT NULL,
      size_usd REAL NOT NULL,
      leverage REAL DEFAULT 1,
      stop_loss REAL NOT NULL,
      take_profit_1 REAL,
      take_profit_2 REAL,
      take_profit_3 REAL,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'OPEN', 'PARTIAL', 'CLOSED', 'STOPPED', 'CANCELLED')),
      pnl REAL DEFAULT 0,
      pnl_percent REAL DEFAULT 0,
      fees REAL DEFAULT 0,
      entry_time DATETIME,
      exit_time DATETIME,
      exit_reason TEXT,
      confluence_score INTEGER,
      alpha_score INTEGER,
      signal_id INTEGER,
      order_ids TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Signals table - stores all generated signals
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
      confluence_score INTEGER NOT NULL,
      alpha_score INTEGER,
      on_chain_score INTEGER,
      technical_score INTEGER,
      derivatives_score INTEGER,
      sentiment_score INTEGER,
      current_price REAL,
      support_1 REAL,
      support_2 REAL,
      support_3 REAL,
      resistance_1 REAL,
      resistance_2 REAL,
      resistance_3 REAL,
      pivot REAL,
      suggested_entry REAL,
      suggested_stop REAL,
      suggested_tp1 REAL,
      suggested_tp2 REAL,
      suggested_tp3 REAL,
      risk_reward REAL,
      reasoning TEXT,
      market_context TEXT,
      executed BOOLEAN DEFAULT FALSE,
      trade_id TEXT,
      valid_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Positions table - current open positions
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset TEXT UNIQUE NOT NULL,
      direction TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL,
      unrealized_pnl REAL DEFAULT 0,
      unrealized_pnl_percent REAL DEFAULT 0,
      stop_loss REAL,
      take_profit REAL,
      leverage REAL DEFAULT 1,
      margin_used REAL,
      liquidation_price REAL,
      trade_id TEXT,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Portfolio metrics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_value REAL NOT NULL,
      cash_balance REAL NOT NULL,
      positions_value REAL DEFAULT 0,
      unrealized_pnl REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      total_pnl_percent REAL DEFAULT 0,
      drawdown REAL DEFAULT 0,
      peak_value REAL,
      exposure_percent REAL DEFAULT 0
    )
  `);

  // Daily metrics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE UNIQUE NOT NULL,
      starting_value REAL,
      ending_value REAL,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      losing_trades INTEGER DEFAULT 0,
      win_rate REAL,
      total_pnl REAL DEFAULT 0,
      total_pnl_percent REAL DEFAULT 0,
      max_drawdown REAL DEFAULT 0,
      sharpe_ratio REAL,
      best_trade REAL,
      worst_trade REAL,
      avg_win REAL,
      avg_loss REAL,
      profit_factor REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Event log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'INFO' CHECK(severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
      message TEXT NOT NULL,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_signals_asset ON signals(asset);
    CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
    CREATE INDEX IF NOT EXISTS idx_signals_executed ON signals(executed);
    CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_metrics(date);
    CREATE INDEX IF NOT EXISTS idx_events_type ON event_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON event_log(created_at);
  `);

  console.log('✅ Database tables created successfully');
};

// Initialize with starting capital
const initializePortfolio = (initialCapital = 10000) => {
  const existing = db.prepare('SELECT COUNT(*) as count FROM portfolio').get();
  
  if (existing.count === 0) {
    db.prepare(`
      INSERT INTO portfolio (total_value, cash_balance, peak_value)
      VALUES (?, ?, ?)
    `).run(initialCapital, initialCapital, initialCapital);
    console.log(`✅ Portfolio initialized with $${initialCapital}`);
  }
};

// Run migrations
createTables();

export { db, initializePortfolio };
export default db;
