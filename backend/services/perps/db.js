const { Pool } = require('pg');
const config = require('./config');

let pool = null;

const getPool = () => {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
};

const query = async (text, params) => {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
};

module.exports = { getPool, query };
