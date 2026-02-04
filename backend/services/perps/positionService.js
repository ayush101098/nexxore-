const { query } = require('./db');
const config = require('./config');
const { computeLiquidationPrice, computePnL, computeMarginInfo } = require('./riskEngine');

const createTrade = async (trade) => {
  await query(
    `INSERT INTO perps_trades (id, wallet_address, chain, market, side, order_type, price, amount, leverage, execution_model, execution_status, execution_mode, status, route, fee_rate, fee_amount, fee_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      trade.id,
      trade.wallet_address,
      trade.chain,
      trade.market,
      trade.side,
      trade.order_type,
      trade.price,
      trade.amount,
      trade.leverage,
      trade.execution_model,
      trade.execution_status,
      trade.execution_mode,
      trade.status,
      trade.route,
      trade.fee_rate,
      trade.fee_amount,
      trade.fee_role
    ]
  );

  await query(
    `INSERT INTO perps_user_trades (id, wallet_address, chain, market, side, order_type, price, amount, leverage, execution_model, execution_status, execution_mode, status, route, fee_rate, fee_amount, fee_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      trade.id,
      trade.wallet_address,
      trade.chain,
      trade.market,
      trade.side,
      trade.order_type,
      trade.price,
      trade.amount,
      trade.leverage,
      trade.execution_model,
      trade.execution_status,
      trade.execution_mode,
      trade.status,
      trade.route,
      trade.fee_rate,
      trade.fee_amount,
      trade.fee_role
    ]
  );
};

const createPosition = async ({ walletAddress, chain, market, side, price, amount, leverage, tpPrice, slPrice }) => {
  const { notional } = computeMarginInfo({ amount, leverage });
  const size = notional / Math.max(price, 1e-6);
  const liqPrice = computeLiquidationPrice({
    entryPrice: price,
    leverage,
    side,
    maintenanceMarginRate: config.maintenanceMarginRate
  });

  const result = await query(
    `INSERT INTO perps_positions (wallet_address, chain, market, side, size, entry_price, mark_price, liq_price, unrealized_pnl, realized_pnl, margin, leverage, tp_price, sl_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [walletAddress, chain, market, side, size, price, price, liqPrice, 0, 0, amount, leverage, tpPrice || null, slPrice || null]
  );

  return result.rows[0];
};

const createOrder = async ({ walletAddress, chain, market, side, orderType, price, amount, leverage, reduceOnly, postOnly, tpPrice, slPrice, remainingSize }) => {
  const result = await query(
    `INSERT INTO perps_orders (wallet_address, chain, market, side, order_type, price, amount, leverage, remaining_size, reduce_only, post_only, tp_price, sl_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [walletAddress, chain, market, side, orderType, price, amount, leverage, remainingSize || null, reduceOnly || false, postOnly || false, tpPrice || null, slPrice || null]
  );
  return result.rows[0];
};

const updateOrderStatus = async ({ orderId, status }) => {
  const result = await query(
    `UPDATE perps_orders SET status = $1 WHERE id = $2 RETURNING *`,
    [status, orderId]
  );
  return result.rows[0];
};

const getOpenOrders = async () => {
  const result = await query('SELECT * FROM perps_orders WHERE status = $1 ORDER BY created_at ASC', ['open']);
  return result.rows;
};

const getOpenPositionForMarket = async ({ walletAddress, market }) => {
  const result = await query(
    'SELECT * FROM perps_positions WHERE wallet_address = $1 AND market = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
    [walletAddress, market, 'open']
  );
  return result.rows[0] || null;
};

const reducePosition = async ({ positionId, reduceSize, closePrice, reason }) => {
  const result = await query('SELECT * FROM perps_positions WHERE id = $1', [positionId]);
  const position = result.rows[0];
  if (!position) return null;

  const newSize = Math.max(0, Number(position.size) - Number(reduceSize));
  const reductionRatio = position.size > 0 ? Number(reduceSize) / Number(position.size) : 1;
  const realizedPnl = computePnL({
    entryPrice: position.entry_price,
    markPrice: closePrice,
    size: reduceSize,
    side: position.side
  });

  const newMargin = Number(position.margin || 0) * (1 - reductionRatio);

  if (newSize <= 0) {
    await query(
      `UPDATE perps_positions
       SET status = $1, closed_at = NOW(), realized_pnl = COALESCE(realized_pnl, 0) + $2, mark_price = $3, size = 0, margin = 0
       WHERE id = $4`,
      [reason || 'closed', realizedPnl, closePrice, positionId]
    );
    return { ...position, realized_pnl: (position.realized_pnl || 0) + realizedPnl, status: reason || 'closed', mark_price: closePrice, size: 0, margin: 0 };
  }

  await query(
    `UPDATE perps_positions
     SET size = $1, margin = $2, realized_pnl = COALESCE(realized_pnl, 0) + $3, mark_price = $4
     WHERE id = $5`,
    [newSize, newMargin, realizedPnl, closePrice, positionId]
  );

  return { ...position, size: newSize, margin: newMargin, realized_pnl: (position.realized_pnl || 0) + realizedPnl, mark_price: closePrice };
};

const getOrdersByWallet = async (walletAddress) => {
  const result = await query('SELECT * FROM perps_orders WHERE wallet_address = $1 ORDER BY created_at DESC', [walletAddress]);
  return result.rows;
};

const updateMarkPrices = async (markPrices) => {
  if (!markPrices || typeof markPrices !== 'object') {
    return; // Nothing to update
  }
  
  const updates = Object.entries(markPrices);
  if (updates.length === 0) {
    return; // No markets to update
  }
  
  for (const [market, markPrice] of updates) {
    if (!market || markPrice === null || markPrice === undefined) continue;
    
    try {
      await query(
        `UPDATE perps_positions
         SET mark_price = $1,
             unrealized_pnl = (CASE WHEN side = 'long' THEN ($1 - entry_price) * size ELSE (entry_price - $1) * size END)
         WHERE market = $2 AND status = 'open'`,
        [markPrice, market]
      );
    } catch (error) {
      console.error(`Failed to update mark price for ${market}:`, error.message);
    }
  }
};

const closePosition = async ({ positionId, closePrice, reason }) => {
  const result = await query('SELECT * FROM perps_positions WHERE id = $1', [positionId]);
  const position = result.rows[0];
  if (!position) return null;

  const pnl = computePnL({ entryPrice: position.entry_price, markPrice: closePrice, size: position.size, side: position.side });

  await query(
    `UPDATE perps_positions
     SET status = $1, closed_at = NOW(), realized_pnl = $2, mark_price = $3
     WHERE id = $4`,
    [reason || 'closed', pnl, closePrice, positionId]
  );

  return { ...position, realized_pnl: pnl, status: reason || 'closed', mark_price: closePrice };
};

const getOpenPositions = async () => {
  const result = await query('SELECT * FROM perps_positions WHERE status = $1', ['open']);
  return result.rows;
};

const getPositionsByWallet = async (walletAddress) => {
  const result = await query('SELECT * FROM perps_positions WHERE wallet_address = $1 ORDER BY created_at DESC', [walletAddress]);
  return result.rows;
};

const getTradeHistory = async (walletAddress) => {
  const result = await query('SELECT * FROM perps_user_trades WHERE wallet_address = $1 ORDER BY created_at DESC', [walletAddress]);
  return result.rows;
};

module.exports = {
  createTrade,
  createPosition,
  createOrder,
  updateOrderStatus,
  getOpenOrders,
  getOrdersByWallet,
  updateMarkPrices,
  closePosition,
  getOpenPositions,
  getPositionsByWallet,
  getTradeHistory,
  getOpenPositionForMarket,
  reducePosition
};
