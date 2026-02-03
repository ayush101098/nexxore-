const { query } = require('./db');

const writeOrderbookUpdate = async ({ market, side, price, size, orderId, status }) => {
  await query(
    `INSERT INTO perps_orderbook_updates (market, side, price, size, order_id, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [market, side, price, size, orderId || null, status || 'open']
  );
};

module.exports = { writeOrderbookUpdate };
