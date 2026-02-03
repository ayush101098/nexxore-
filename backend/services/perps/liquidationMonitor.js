const { query } = require('./db');
const { computePnL } = require('./riskEngine');

const createAlert = async ({ walletAddress, market, alertType, message }) => {
  await query(
    `INSERT INTO perps_alerts (wallet_address, market, alert_type, message)
     VALUES ($1,$2,$3,$4)`,
    [walletAddress, market, alertType, message]
  );
};

const liquidatePosition = async ({ position, markPrice }) => {
  const pnl = computePnL({ entryPrice: position.entry_price, markPrice, size: position.size, side: position.side });

  await query(
    `UPDATE perps_positions
     SET status = 'liquidated', closed_at = NOW(), realized_pnl = $1, mark_price = $2
     WHERE id = $3`,
    [pnl, markPrice, position.id]
  );

  await query(
    `INSERT INTO perps_liquidations (wallet_address, market, position_id, liq_price, mark_price, size)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [position.wallet_address, position.market, position.id, position.liq_price, markPrice, position.size]
  );

  await createAlert({
    walletAddress: position.wallet_address,
    market: position.market,
    alertType: 'liquidation',
    message: `Position liquidated at ${markPrice}`
  });

  return { ...position, status: 'liquidated', realized_pnl: pnl, mark_price: markPrice };
};

const checkLiquidations = async ({ positions, markPrices }) => {
  const liquidated = [];
  for (const position of positions) {
    const markPrice = markPrices[position.market];
    if (!markPrice || !position.liq_price) continue;

    const shouldLiquidate = position.side === 'long'
      ? markPrice <= position.liq_price
      : markPrice >= position.liq_price;

    if (shouldLiquidate) {
      const result = await liquidatePosition({ position, markPrice });
      liquidated.push(result);
    }
  }
  return liquidated;
};

module.exports = { checkLiquidations, createAlert };
