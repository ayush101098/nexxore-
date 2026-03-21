/**
 * Trader Analytics Tools (10 tools)
 *
 *  1. pulse_trader_profile       — Full trader profile & metrics
 *  2. rank_traders               — Leaderboard by any metric
 *  3. trader_positions           — Current open positions
 *  4. trader_history             — Recent fills / trade log
 *  5. trader_pnl_breakdown      — PnL breakdown by coin
 *  6. hidden_gem_discovery       — Find underrated consistent wallets
 *  7. trader_comparison          — Head-to-head comparison
 *  8. trader_risk_analysis       — Risk metrics & drawdown
 *  9. trader_coin_exposure       — Notional exposure by coin
 * 10. trader_performance_over_time — Daily PnL timeseries
 */

import { z } from 'zod';
import { query, queryOne } from '../db.js';

// ─── Tool 1: pulse_trader_profile ────────────────────────

export const traderProfileSchema = z.object({
  address: z.string().describe('Wallet address'),
});

export async function pulseTraderProfile(
  args: z.infer<typeof traderProfileSchema>
) {
  const wallet = args.address.toLowerCase();

  const [metrics, cohort, positions, recentFills] = await Promise.all([
    queryOne(
      `SELECT * FROM trading.wallet_metrics WHERE wallet = $1`,
      [wallet]
    ),
    queryOne(
      `SELECT * FROM trading.wallet_cohorts WHERE wallet = $1`,
      [wallet]
    ),
    query(
      `SELECT coin, side, size, entry_price, mark_price, unrealized_pnl, leverage
       FROM trading.positions WHERE wallet = $1`,
      [wallet]
    ),
    query(
      `SELECT coin, side, price, size, notional, closed_pnl, time
       FROM trading.fills WHERE wallet = $1
       ORDER BY time DESC LIMIT 10`,
      [wallet]
    ),
  ]);

  if (!metrics) {
    return { error: `Wallet ${args.address} not found` };
  }

  return {
    wallet,
    metrics: {
      totalPnl: Number(metrics.total_pnl),
      tradeCount: Number(metrics.trade_count),
      winRate: Number(metrics.win_rate),
      totalVolume: Number(metrics.total_volume),
      totalFees: Number(metrics.total_fees),
      largestWin: Number(metrics.largest_win),
      largestLoss: Number(metrics.largest_loss),
      profitFactor: Number(metrics.profit_factor),
      sharpeRatio: Number(metrics.sharpe_ratio),
      maxDrawdown: Number(metrics.max_drawdown),
      uniqueCoins: Number(metrics.unique_coins_traded),
      activeSince: metrics.active_since,
      lastTrade: metrics.last_trade,
    },
    cohort: cohort
      ? {
          pnlTier: cohort.pnl_tier,
          sizeTier: cohort.size_tier,
          consistency: cohort.consistency,
          style: cohort.style,
          riskProfile: cohort.risk_profile,
        }
      : null,
    openPositions: positions.map((p: Record<string, unknown>) => ({
      coin: p.coin,
      side: p.side,
      size: Number(p.size),
      entryPrice: Number(p.entry_price),
      markPrice: Number(p.mark_price),
      unrealizedPnl: Number(p.unrealized_pnl),
      leverage: Number(p.leverage),
    })),
    recentFills: recentFills.map((f: Record<string, unknown>) => ({
      coin: f.coin,
      side: f.side,
      price: Number(f.price),
      size: Number(f.size),
      notional: Number(f.notional),
      closedPnl: Number(f.closed_pnl),
      time: f.time,
    })),
  };
}

// ─── Tool 2: rank_traders ────────────────────────────────

export const rankTradersSchema = z.object({
  metric: z
    .enum([
      'total_pnl',
      'win_rate',
      'total_volume',
      'trade_count',
      'profit_factor',
      'sharpe_ratio',
    ])
    .default('total_pnl')
    .describe('Metric to rank by'),
  direction: z.enum(['desc', 'asc']).default('desc'),
  pnl_tier: z
    .enum(['money_printer', 'profitable', 'breakeven', 'losing', 'giga_rekt'])
    .optional(),
  min_trades: z.number().default(10),
  limit: z.number().default(25),
});

export async function rankTraders(args: z.infer<typeof rankTradersSchema>) {
  const conditions = [`wm.trade_count >= $1`];
  const params: unknown[] = [args.min_trades];
  let paramIdx = 2;

  if (args.pnl_tier) {
    conditions.push(`wc.pnl_tier = $${paramIdx++}`);
    params.push(args.pnl_tier);
  }

  params.push(args.limit);

  const rows = await query(
    `SELECT
       wm.wallet,
       wm.total_pnl,
       wm.trade_count,
       wm.win_rate,
       wm.total_volume,
       wm.profit_factor,
       wm.sharpe_ratio,
       wc.pnl_tier,
       wc.size_tier,
       wc.style
     FROM trading.wallet_metrics wm
     LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
     WHERE ${conditions.join(' AND ')}
     ORDER BY wm.${args.metric} ${args.direction.toUpperCase()}
     LIMIT $${paramIdx}`,
    params
  );

  return {
    metric: args.metric,
    direction: args.direction,
    traders: rows.map((r: Record<string, unknown>, i: number) => ({
      rank: i + 1,
      wallet: r.wallet,
      [args.metric]: Number(r[args.metric as string]),
      totalPnl: Number(r.total_pnl),
      winRate: Number(r.win_rate),
      tradeCount: Number(r.trade_count),
      pnlTier: r.pnl_tier,
      sizeTier: r.size_tier,
      style: r.style,
    })),
  };
}

// ─── Tool 3: trader_positions ────────────────────────────

export const traderPositionsSchema = z.object({
  address: z.string().describe('Wallet address'),
});

export async function traderPositions(
  args: z.infer<typeof traderPositionsSchema>
) {
  const wallet = args.address.toLowerCase();

  const positions = await query(
    `SELECT coin, side, size, entry_price, mark_price,
            unrealized_pnl, leverage, liquidation_price, margin_used, updated_at
     FROM trading.positions
     WHERE wallet = $1
     ORDER BY (size * entry_price) DESC`,
    [wallet]
  );

  const totalNotional = positions.reduce(
    (sum: number, p: Record<string, unknown>) =>
      sum + Number(p.size) * Number(p.entry_price),
    0
  );

  return {
    wallet,
    positionCount: positions.length,
    totalNotional,
    positions: positions.map((p: Record<string, unknown>) => ({
      coin: p.coin,
      side: p.side,
      size: Number(p.size),
      entryPrice: Number(p.entry_price),
      markPrice: Number(p.mark_price),
      unrealizedPnl: Number(p.unrealized_pnl),
      leverage: Number(p.leverage),
      liquidationPrice: Number(p.liquidation_price),
      marginUsed: Number(p.margin_used),
      updatedAt: p.updated_at,
    })),
  };
}

// ─── Tool 4: trader_history ──────────────────────────────

export const traderHistorySchema = z.object({
  address: z.string().describe('Wallet address'),
  coin: z.string().optional().describe('Filter by coin'),
  hours: z.number().default(168).describe('Lookback hours (default 7d)'),
  limit: z.number().default(100),
});

export async function traderHistory(
  args: z.infer<typeof traderHistorySchema>
) {
  const wallet = args.address.toLowerCase();
  const conditions = [
    `wallet = $1`,
    `time > NOW() - ($2 || ' hours')::INTERVAL`,
  ];
  const params: unknown[] = [wallet, args.hours];
  let paramIdx = 3;

  if (args.coin) {
    conditions.push(`coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  params.push(args.limit);

  const fills = await query(
    `SELECT coin, side, price, size, notional, closed_pnl, fee, time, trade_id
     FROM trading.fills
     WHERE ${conditions.join(' AND ')}
     ORDER BY time DESC
     LIMIT $${paramIdx}`,
    params
  );

  return {
    wallet,
    count: fills.length,
    fills: fills.map((f: Record<string, unknown>) => ({
      coin: f.coin,
      side: f.side,
      price: Number(f.price),
      size: Number(f.size),
      notional: Number(f.notional),
      closedPnl: Number(f.closed_pnl),
      fee: Number(f.fee),
      time: f.time,
    })),
  };
}

// ─── Tool 5: trader_pnl_breakdown ────────────────────────

export const pnlBreakdownSchema = z.object({
  address: z.string().describe('Wallet address'),
});

export async function traderPnlBreakdown(
  args: z.infer<typeof pnlBreakdownSchema>
) {
  const wallet = args.address.toLowerCase();

  const breakdown = await query(
    `SELECT
       coin,
       SUM(closed_pnl) AS total_pnl,
       COUNT(*) AS trade_count,
       SUM(CASE WHEN closed_pnl > 0 THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN closed_pnl < 0 THEN 1 ELSE 0 END) AS losses,
       MAX(closed_pnl) AS largest_win,
       MIN(closed_pnl) AS largest_loss,
       SUM(notional) AS total_volume
     FROM trading.fills
     WHERE wallet = $1
     GROUP BY coin
     ORDER BY SUM(closed_pnl) DESC`,
    [wallet]
  );

  return {
    wallet,
    coinCount: breakdown.length,
    coins: breakdown.map((c: Record<string, unknown>) => ({
      coin: c.coin,
      totalPnl: Number(c.total_pnl),
      tradeCount: Number(c.trade_count),
      wins: Number(c.wins),
      losses: Number(c.losses),
      winRate:
        Number(c.trade_count) > 0
          ? Math.round((Number(c.wins) / Number(c.trade_count)) * 10000) / 100
          : 0,
      largestWin: Number(c.largest_win),
      largestLoss: Number(c.largest_loss),
      totalVolume: Number(c.total_volume),
    })),
  };
}

// ─── Tool 6: hidden_gem_discovery ────────────────────────

export const hiddenGemSchema = z.object({
  min_win_rate: z.number().default(55).describe('Minimum win rate %'),
  min_trades: z.number().default(50).describe('Minimum trade count'),
  max_volume: z.number().default(5000000).describe('Max volume (excludes whales)'),
  limit: z.number().default(20),
});

export async function hiddenGemDiscovery(
  args: z.infer<typeof hiddenGemSchema>
) {
  const rows = await query(
    `SELECT
       wm.wallet,
       wm.total_pnl,
       wm.trade_count,
       wm.win_rate,
       wm.total_volume,
       wm.profit_factor,
       wm.sharpe_ratio,
       wm.max_drawdown,
       wc.pnl_tier,
       wc.size_tier,
       wc.consistency,
       wc.style
     FROM trading.wallet_metrics wm
     JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
     WHERE wm.win_rate >= $1
       AND wm.trade_count >= $2
       AND wm.total_volume <= $3
       AND wm.total_pnl > 0
       AND wc.size_tier IN ('fish', 'shrimp')
     ORDER BY wm.profit_factor DESC, wm.sharpe_ratio DESC
     LIMIT $4`,
    [args.min_win_rate, args.min_trades, args.max_volume, args.limit]
  );

  return {
    criteria: {
      minWinRate: args.min_win_rate,
      minTrades: args.min_trades,
      maxVolume: args.max_volume,
    },
    gems: rows.map((r: Record<string, unknown>, i: number) => ({
      rank: i + 1,
      wallet: r.wallet,
      totalPnl: Number(r.total_pnl),
      winRate: Number(r.win_rate),
      tradeCount: Number(r.trade_count),
      totalVolume: Number(r.total_volume),
      profitFactor: Number(r.profit_factor),
      sharpeRatio: Number(r.sharpe_ratio),
      consistency: r.consistency,
      style: r.style,
    })),
  };
}

// ─── Tool 7: trader_comparison ───────────────────────────

export const traderComparisonSchema = z.object({
  wallets: z
    .array(z.string())
    .min(2)
    .max(5)
    .describe('2-5 wallet addresses to compare'),
});

export async function traderComparison(
  args: z.infer<typeof traderComparisonSchema>
) {
  const wallets = args.wallets.map((w) => w.toLowerCase());
  const placeholders = wallets.map((_, i) => `$${i + 1}`).join(',');

  const rows = await query(
    `SELECT
       wm.wallet,
       wm.total_pnl,
       wm.trade_count,
       wm.win_rate,
       wm.total_volume,
       wm.profit_factor,
       wm.sharpe_ratio,
       wm.max_drawdown,
       wm.largest_win,
       wm.largest_loss,
       wm.unique_coins_traded,
       wc.pnl_tier,
       wc.size_tier,
       wc.consistency,
       wc.style,
       wc.risk_profile
     FROM trading.wallet_metrics wm
     LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
     WHERE wm.wallet IN (${placeholders})`,
    wallets
  );

  return {
    traders: rows.map((r: Record<string, unknown>) => ({
      wallet: r.wallet,
      totalPnl: Number(r.total_pnl),
      tradeCount: Number(r.trade_count),
      winRate: Number(r.win_rate),
      totalVolume: Number(r.total_volume),
      profitFactor: Number(r.profit_factor),
      sharpeRatio: Number(r.sharpe_ratio),
      maxDrawdown: Number(r.max_drawdown),
      largestWin: Number(r.largest_win),
      largestLoss: Number(r.largest_loss),
      uniqueCoins: Number(r.unique_coins_traded),
      pnlTier: r.pnl_tier,
      sizeTier: r.size_tier,
      consistency: r.consistency,
      style: r.style,
      riskProfile: r.risk_profile,
    })),
  };
}

// ─── Tool 8: trader_risk_analysis ────────────────────────

export const riskAnalysisSchema = z.object({
  address: z.string().describe('Wallet address'),
});

export async function traderRiskAnalysis(
  args: z.infer<typeof riskAnalysisSchema>
) {
  const wallet = args.address.toLowerCase();

  const [metrics, leverageStats, positionConcentration] = await Promise.all([
    queryOne(
      `SELECT total_pnl, win_rate, max_drawdown, profit_factor,
              sharpe_ratio, largest_win, largest_loss, total_volume, trade_count
       FROM trading.wallet_metrics WHERE wallet = $1`,
      [wallet]
    ),
    queryOne(
      `SELECT
         AVG(leverage) AS avg_leverage,
         MAX(leverage) AS max_leverage,
         STDDEV(leverage) AS leverage_stddev
       FROM trading.positions WHERE wallet = $1`,
      [wallet]
    ),
    query(
      `SELECT coin, (size * entry_price) AS notional
       FROM trading.positions
       WHERE wallet = $1
       ORDER BY (size * entry_price) DESC`,
      [wallet]
    ),
  ]);

  if (!metrics) {
    return { error: `Wallet ${args.address} not found` };
  }

  const totalNotional = positionConcentration.reduce(
    (sum: number, p: Record<string, unknown>) => sum + Number(p.notional),
    0
  );

  const concentration = positionConcentration.map(
    (p: Record<string, unknown>) => ({
      coin: p.coin,
      notional: Number(p.notional),
      percentage:
        totalNotional > 0
          ? Math.round((Number(p.notional) / totalNotional) * 10000) / 100
          : 0,
    })
  );

  const winLossRatio =
    Math.abs(Number(metrics.largest_loss)) > 0
      ? Math.round(
          (Number(metrics.largest_win) / Math.abs(Number(metrics.largest_loss))) *
            100
        ) / 100
      : Infinity;

  return {
    wallet,
    riskMetrics: {
      maxDrawdown: Number(metrics.max_drawdown),
      profitFactor: Number(metrics.profit_factor),
      sharpeRatio: Number(metrics.sharpe_ratio),
      winLossRatio,
      avgLeverage: Number(leverageStats?.avg_leverage || 0),
      maxLeverage: Number(leverageStats?.max_leverage || 0),
      leverageVolatility: Number(leverageStats?.leverage_stddev || 0),
    },
    positionConcentration: concentration,
    totalNotional,
    riskAssessment:
      Number(metrics.max_drawdown) > 50
        ? 'HIGH_RISK'
        : Number(metrics.max_drawdown) > 25
        ? 'MODERATE_RISK'
        : 'LOW_RISK',
  };
}

// ─── Tool 9: trader_coin_exposure ────────────────────────

export const coinExposureSchema = z.object({
  address: z.string().describe('Wallet address'),
});

export async function traderCoinExposure(
  args: z.infer<typeof coinExposureSchema>
) {
  const wallet = args.address.toLowerCase();

  const exposure = await query(
    `SELECT
       coin,
       side,
       size,
       entry_price,
       (size * entry_price) AS notional,
       unrealized_pnl,
       leverage
     FROM trading.positions
     WHERE wallet = $1
     ORDER BY (size * entry_price) DESC`,
    [wallet]
  );

  const longNotional = exposure
    .filter((p: Record<string, unknown>) => p.side === 'long')
    .reduce(
      (sum: number, p: Record<string, unknown>) => sum + Number(p.notional),
      0
    );
  const shortNotional = exposure
    .filter((p: Record<string, unknown>) => p.side === 'short')
    .reduce(
      (sum: number, p: Record<string, unknown>) => sum + Number(p.notional),
      0
    );

  return {
    wallet,
    totalLongNotional: longNotional,
    totalShortNotional: shortNotional,
    netExposure: longNotional - shortNotional,
    coins: exposure.map((p: Record<string, unknown>) => ({
      coin: p.coin,
      side: p.side,
      size: Number(p.size),
      entryPrice: Number(p.entry_price),
      notional: Number(p.notional),
      unrealizedPnl: Number(p.unrealized_pnl),
      leverage: Number(p.leverage),
    })),
  };
}

// ─── Tool 10: trader_performance_over_time ───────────────

export const perfOverTimeSchema = z.object({
  address: z.string().describe('Wallet address'),
  days: z.number().default(30).describe('Number of days to look back'),
  granularity: z
    .enum(['1h', '1d', '1w'])
    .default('1d')
    .describe('Time bucket granularity'),
});

export async function traderPerformanceOverTime(
  args: z.infer<typeof perfOverTimeSchema>
) {
  const wallet = args.address.toLowerCase();

  const intervalMap: Record<string, string> = {
    '1h': '1 hour',
    '1d': '1 day',
    '1w': '1 week',
  };

  const timeseries = await query(
    `SELECT
       time_bucket($1::INTERVAL, time) AS bucket,
       SUM(closed_pnl) AS period_pnl,
       COUNT(*) AS trade_count,
       SUM(CASE WHEN closed_pnl > 0 THEN 1 ELSE 0 END) AS wins,
       SUM(notional) AS volume,
       SUM(fee) AS fees
     FROM trading.fills
     WHERE wallet = $2
       AND time > NOW() - ($3 || ' days')::INTERVAL
     GROUP BY bucket
     ORDER BY bucket`,
    [intervalMap[args.granularity], wallet, args.days]
  );

  // Compute cumulative PnL
  let cumPnl = 0;
  const data = timeseries.map((row: Record<string, unknown>) => {
    cumPnl += Number(row.period_pnl);
    return {
      timestamp: row.bucket,
      periodPnl: Number(row.period_pnl),
      cumulativePnl: Math.round(cumPnl * 100) / 100,
      tradeCount: Number(row.trade_count),
      wins: Number(row.wins),
      volume: Number(row.volume),
      fees: Number(row.fees),
    };
  });

  return {
    wallet,
    granularity: args.granularity,
    days: args.days,
    dataPoints: data.length,
    timeseries: data,
  };
}
