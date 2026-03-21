/**
 * TimescaleDB connection pool for the MCP server.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://nexxore:nexxore_dev_2026@localhost:5433/nexxore_mcp',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected pool error:', err);
});

/**
 * Execute a SQL query and return rows.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/**
 * Execute a SQL query and return the first row.
 */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await pool.query(text, params);
  return (result.rows[0] as T) ?? null;
}

/**
 * Execute a SQL query and return a scalar value.
 */
export async function queryScalar<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await pool.query(text, params);
  if (result.rows.length === 0) return null;
  const firstKey = Object.keys(result.rows[0])[0];
  return result.rows[0][firstKey] as T;
}

export { pool };
export default { query, queryOne, queryScalar, pool };
