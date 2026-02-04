const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

let db = null;

const getDB = () => {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'perps.db');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
  }
  return db;
};

// PostgreSQL-compatible query wrapper for SQLite
const query = async (text, params = []) => {
  const database = getDB();
  
  // Convert PostgreSQL $1, $2 placeholders to ? for SQLite
  let sqliteQuery = text;
  if (params && params.length > 0) {
    params.forEach((_, index) => {
      sqliteQuery = sqliteQuery.replace(`$${index + 1}`, '?');
    });
  }
  
  try {
    // Detect query type
    const queryType = text.trim().toLowerCase().split(' ')[0];
    const stmt = database.prepare(sqliteQuery);
    
    if (queryType === 'select' || queryType === 'with') {
      const rows = stmt.all(...params);
      return { rows, rowCount: rows.length };
    } else {
      const info = stmt.run(...params);
      return { rows: [], rowCount: info.changes };
    }
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

module.exports = { getDB, query };
