const config = require('./config');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const computeLiquidationPrice = ({ entryPrice, leverage, side, maintenanceMarginRate }) => {
  const lev = Math.max(1, leverage);
  const mmr = maintenanceMarginRate;

  if (side === 'long') {
    return entryPrice * (1 - (1 / lev) + mmr);
  }
  return entryPrice * (1 + (1 / lev) - mmr);
};

const validateOrder = ({ amount, leverage }) => {
  if (!amount || amount <= 0) {
    return { ok: false, reason: 'Invalid margin amount' };
  }
  if (!leverage || leverage < 1) {
    return { ok: false, reason: 'Leverage must be at least 1x' };
  }
  if (leverage > config.maxLeverage) {
    return { ok: false, reason: `Max leverage is ${config.maxLeverage}x` };
  }
  return { ok: true };
};

const computePnL = ({ entryPrice, markPrice, size, side }) => {
  if (!entryPrice || !markPrice || !size) return 0;
  const diff = (markPrice - entryPrice) * size;
  return side === 'long' ? diff : -diff;
};

const computeMarginInfo = ({ amount, leverage }) => {
  const notional = amount * leverage;
  return { notional, margin: amount };
};

module.exports = {
  computeLiquidationPrice,
  validateOrder,
  computePnL,
  computeMarginInfo,
  clamp
};
