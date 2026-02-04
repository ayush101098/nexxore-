const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || './data/perps.db';
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log('🗄️  Running database migrations...');

// Create tables
const migrations = [
  // Users and authentication
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT UNIQUE NOT NULL,
    chain TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // Trading positions
  `CREATE TABLE IF NOT EXISTS perps_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL,
    leverage INTEGER NOT NULL,
    margin REAL NOT NULL,
    unrealized_pnl REAL DEFAULT 0,
    liquidation_price REAL,
    status TEXT DEFAULT 'open',
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // Order book
  `CREATE TABLE IF NOT EXISTS perps_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    market TEXT NOT NULL,
    type TEXT NOT NULL,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    price REAL,
    filled_size REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    time_in_force TEXT DEFAULT 'GTC',
    reduce_only INTEGER DEFAULT 0,
    post_only INTEGER DEFAULT 0,
    stop_price REAL,
    take_profit_price REAL,
    stop_loss_price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    filled_at DATETIME,
    cancelled_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // Trade history
  `CREATE TABLE IF NOT EXISTS perps_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market TEXT NOT NULL,
    price REAL NOT NULL,
    size REAL NOT NULL,
    side TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    taker_fee REAL,
    maker_fee REAL
  )`,

  // User-specific trades
  `CREATE TABLE IF NOT EXISTS perps_user_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id INTEGER,
    position_id INTEGER,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL NOT NULL,
    realized_pnl REAL DEFAULT 0,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (order_id) REFERENCES perps_orders(id),
    FOREIGN KEY (position_id) REFERENCES perps_positions(id)
  )`,

  // Liquidations
  `CREATE TABLE IF NOT EXISTS perps_liquidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    position_id INTEGER NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    size REAL NOT NULL,
    entry_price REAL NOT NULL,
    liquidation_price REAL NOT NULL,
    final_price REAL NOT NULL,
    loss REAL NOT NULL,
    liquidated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (position_id) REFERENCES perps_positions(id)
  )`,

  // Price alerts
  `CREATE TABLE IF NOT EXISTS perps_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    market TEXT NOT NULL,
    type TEXT NOT NULL,
    target_price REAL NOT NULL,
    current_price REAL,
    triggered INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    triggered_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // Market metadata cache
  `CREATE TABLE IF NOT EXISTS market_metadata (
    market TEXT PRIMARY KEY,
    last_price REAL,
    mark_price REAL,
    index_price REAL,
    funding_rate REAL,
    open_interest REAL,
    volume_24h REAL,
    high_24h REAL,
    low_24h REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`
];

// Create indexes
const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_positions_user ON perps_positions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_positions_market ON perps_positions(market)',
  'CREATE INDEX IF NOT EXISTS idx_positions_status ON perps_positions(status)',
  'CREATE INDEX IF NOT EXISTS idx_orders_user ON perps_orders(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_orders_market ON perps_orders(market)',
  'CREATE INDEX IF NOT EXISTS idx_orders_status ON perps_orders(status)',
  'CREATE INDEX IF NOT EXISTS idx_trades_market ON perps_trades(market)',
  'CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON perps_trades(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_user_trades_user ON perps_user_trades(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_liquidations_user ON perps_liquidations(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_alerts_user ON perps_alerts(user_id)'
];

try {
  // Run migrations
  migrations.forEach((migration, index) => {
    db.exec(migration);
    console.log(`✅ Migration ${index + 1}/${migrations.length} completed`);
  });

  // Create indexes
  indexes.forEach((index, i) => {
    db.exec(index);
    console.log(`✅ Index ${i + 1}/${indexes.length} created`);
  });

  // Seed initial market metadata
  const markets = (process.env.MARKETS || '').split(',').filter(Boolean);
  const insertMarket = db.prepare(`
    INSERT OR IGNORE INTO market_metadata (market, last_price, updated_at)
    VALUES (?, 0, CURRENT_TIMESTAMP)
  `);

  markets.forEach(market => {
    insertMarket.run(market);
  });

  console.log(`✅ Seeded ${markets.length} markets`);
  console.log('✅ Database migration completed successfully!');
  console.log(`📍 Database location: ${path.resolve(dbPath)}`);

} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
