class BacktestEngine {
  constructor(config = {}) {
    this.config = {
      slippageBps: 10,
      feeBps: 5,
      ...config
    };
  }

  simulateTrade({ entryPrice, exitPrice, side = 'LONG', size = 1 }) {
    const slippage = (this.config.slippageBps / 10000) * entryPrice;
    const fee = (this.config.feeBps / 10000) * entryPrice;
    const effectiveEntry = entryPrice + (side === 'LONG' ? slippage : -slippage) + fee;
    const pnl = (side === 'LONG' ? exitPrice - effectiveEntry : effectiveEntry - exitPrice) * size;
    return pnl;
  }

  backtest(hypotheses = [], priceSeries = []) {
    const results = [];

    hypotheses.forEach(h => {
      const entry = priceSeries.find(p => p.timestamp >= h.entryTimestamp) || priceSeries[0];
      const exit = priceSeries.find(p => p.timestamp >= h.exitTimestamp) || priceSeries[priceSeries.length - 1];
      if (!entry || !exit) return;

      const pnl = this.simulateTrade({
        entryPrice: entry.price,
        exitPrice: exit.price,
        side: h.bias,
        size: h.size || 1
      });

      results.push({
        id: h.hypothesis_id,
        pnl,
        win: pnl > 0
      });
    });

    const winRate = results.length ? results.filter(r => r.win).length / results.length : 0;
    return { results, winRate };
  }
}

module.exports = { BacktestEngine };
