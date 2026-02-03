const computeExecutionPlan = ({ notional, price, model }) => {
  const ammDepth = 5_000_000;
  const clobDepth = 3_000_000;
  const ammFee = 0.0005;
  const clobFee = 0.0002;

  let ammFill = 0;
  let clobFill = 0;

  if (model === 'amm') {
    ammFill = notional;
  } else if (model === 'clob') {
    clobFill = notional;
  } else {
    const clobTarget = Math.min(notional * 0.6, clobDepth * 0.8);
    clobFill = Math.min(notional, clobTarget);
    ammFill = Math.max(0, notional - clobFill);
  }

  const ammSlippage = ammFill > 0 ? Math.min(0.015, (ammFill / Math.max(ammDepth, 1)) * 0.004) : 0;
  const clobSlippage = clobFill > 0 ? Math.min(0.008, (clobFill / Math.max(clobDepth, 1)) * 0.002) : 0;
  const weightedSlippage = notional > 0 ? ((ammFill * ammSlippage) + (clobFill * clobSlippage)) / notional : 0;
  const feeRate = notional > 0 ? ((ammFill * ammFee) + (clobFill * clobFee)) / notional : 0;

  return {
    route: `${Math.round((clobFill / Math.max(notional, 1)) * 100)}% CLOB / ${Math.round((ammFill / Math.max(notional, 1)) * 100)}% AMM`,
    expectedPrice: price,
    slippage: weightedSlippage,
    feeRate,
    depth: ammDepth + clobDepth
  };
};

module.exports = { computeExecutionPlan };
