const maxNotionalPerTradeUsd = Number(process.env.RISK_MAX_NOTIONAL_USD || 25000);

module.exports = {
  maxNotionalPerTradeUsd,
  maxNotional: maxNotionalPerTradeUsd,
  maxDailyLossUsd: Number(process.env.RISK_MAX_DAILY_LOSS_USD || 3000),
  minEdgeBps: Number(process.env.RISK_MIN_EDGE_BPS || 300),
  minLiquidityUsd: Number(process.env.RISK_MIN_LIQUIDITY_USD || 10000),
  deribitInstrumentBlacklist: (process.env.RISK_DERIBIT_BLACKLIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  polymarketMarketBlacklist: (process.env.RISK_POLYMARKET_BLACKLIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
};
