const config = require('./risk-config');

function fail(code, message, details) {
  return { ok: false, code, message, details: details || {} };
}

function pass() {
  return { ok: true };
}

function checkDeribitOrder({ legs = [], availableMarginUsd = Number.POSITIVE_INFINITY }) {
  const notional = legs.reduce((sum, leg) => {
    const px = Number(leg.price || leg.mark || leg.ask || leg.bid || 0);
    const qty = Number(leg.qty || leg.amount || 0);
    return sum + Math.abs(px * qty);
  }, 0);

  if (notional > config.maxNotionalPerTradeUsd) {
    return fail('MAX_NOTIONAL_EXCEEDED', `Notional ${notional.toFixed(2)} exceeds max ${config.maxNotionalPerTradeUsd}`, { notional });
  }
  if (availableMarginUsd < notional) {
    return fail('INSUFFICIENT_MARGIN', 'Available margin is below required notional', { availableMarginUsd, required: notional });
  }
  const blocked = legs.find(leg => config.deribitInstrumentBlacklist.includes(String(leg.instrument_name || leg.instrument || '')));
  if (blocked) {
    return fail('BLACKLISTED_INSTRUMENT', `Instrument ${blocked.instrument_name || blocked.instrument} is blocked`);
  }
  return pass();
}

function checkPolymarketOrder({ marketLiquidityUsd = 0, orderUsd = 0, edgeBps = 0, dailyPnlUsd = 0, tokenId = '' }) {
  if (config.polymarketMarketBlacklist.includes(String(tokenId))) {
    return fail('BLACKLISTED_MARKET', `Market ${tokenId} is blocked`);
  }
  if (marketLiquidityUsd < config.minLiquidityUsd) {
    return fail('LOW_LIQUIDITY', `Liquidity ${marketLiquidityUsd} below ${config.minLiquidityUsd}`, { marketLiquidityUsd });
  }
  if (orderUsd > config.maxNotionalPerTradeUsd) {
    return fail('MAX_TRADE_EXCEEDED', `Order value ${orderUsd} exceeds max ${config.maxNotionalPerTradeUsd}`, { orderUsd });
  }
  if (edgeBps < config.minEdgeBps) {
    return fail('EDGE_TOO_LOW', `Edge ${edgeBps}bps below minimum ${config.minEdgeBps}bps`, { edgeBps });
  }
  if (dailyPnlUsd <= -Math.abs(config.maxDailyLossUsd)) {
    return fail('DAILY_LOSS_CAP', `Daily loss cap reached (${dailyPnlUsd})`, { dailyPnlUsd });
  }
  return pass();
}

module.exports = { checkDeribitOrder, checkPolymarketOrder };
