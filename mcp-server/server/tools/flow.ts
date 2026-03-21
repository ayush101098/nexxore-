/**
 * Real-Time Trade Flow Tools (6 tools)
 *
 * 1. largest_trades      — Biggest trades in a time window
 * 2. trade_flow_summary  — Aggregated buy/sell flow per coin
 * 3. whale_alert         — Large fills from whale-tier wallets
 * 4. position_lifecycle  — Trace a wallet's position open → close
 * 5. aggregated_flow     — Net dollar flow across all coins
 * 6. flow_by_cohort      — Trade flow broken down by cohort tier
 */

import { z } from 'zod';
import { query } from '../db.js';

// ─── Tool 1: largest_trades ──────────────────────────────

export const largestTradesSchema = z.object({
  coin: z.string().optional().describe('Filter by coin'),
  hours: z.number().default(1).describe('Lookback hours'),
  limit: z.number().default(25),
});

export async function largestTrades(
  args: z.infer<typeof largestTradesSchema>
) {
  const conditions = [`time > NOW() - ($1 || ' hours')::INTERVAL`];
  const params: unknown[] = [args.hours];
  let paramIdx = 2;

  if (args.coin) {
    conditions.push(`coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  params.push(args.limit);

  const trades = await query(
    `SELECT coin, side, price, size, (size * price) AS notional, time
     FROM trading.market_trades
     WHERE ${conditions.join(' AND ')}
     ORDER BY (size * price) DESC
     LIMIT $${paramIdx}`,
    params
  );

  return {
    hours: args.hours,
    coin: args.coin || 'ALL',
    count: trades.length,
    trades: trades.map((t: Record<string, unknown>) => ({
      coin: t.coin,
      side: t.side,
      price: Number(t.price),
      size: Number(t.size),
      notional: Number(t.notional),
      time: t.time,
    })),
  };
}

// ─── Tool 2: trade_flow_summary ──────────────────────────

export const tradeFlowSchema = z.object({
  hours: z.number().default(1).describe('Lookback hours'),
  limit: z.number().default(20).describe('Top N coins by volume'),
});

export async function tradeFlowSummary(
  args: z.infer<typeof tradeFlowSchema>
) {
  const flows = await query(
    `SELECT
       coin,
       COUNT(*) AS trade_count,
       SUM(CASE WHEN side = 'Buy' THEN size * price ELSE 0 END) AS buy_volume,
       SUM(CASE WHEN side = 'Sell' THEN size * price ELSE 0 END) AS sell_volume,
       SUM(CASE WHEN side = 'Buy' THEN size * price ELSE -(size * price) END) AS net_flow,
       COUNT(*) FILTER (WHERE side = 'Buy') AS buy_count,
       COUNT(*) FILTER (WHERE side = 'Sell') AS sell_count
     FROM trading.market_trades
     WHERE time > NOW() - ($1 || ' hours')::INTERVAL
     GROUP BY coin
     ORDER BY SUM(size * price) DESC
     LIMIT $2`,
    [args.hours, args.limit]
  );

  return {
    hours: args.hours,
    coins: flows.map((f: Record<string, unknown>) => ({
      coin: f.coin,
      tradeCount: Number(f.trade_count),
      buyVolume: Number(f.buy_volume),
      sellVolume: Number(f.sell_volume),
      netFlow: Number(f.net_flow),
      buyCount: Number(f.buy_count),
      sellCount: Number(f.sell_count),
      bias: Number(f.net_flow) > 0 ? 'BUY' : 'SELL',
    })),
  };
}

// ─── Tool 3: whale_alert ─────────────────────────────────

export const whaleAlertSchema = z.object({
  min_notional: z
    .number()
    .default(100000)
    .describe('Minimum notional value in USD'),
  hours: z.number().default(4).describe('Lookback hours'),
  limit: z.number().default(50),
});

export async function whaleAlert(args: z.infer<typeof whaleAlertSchema>) {
  const fills = await query(
    `SELECT
       f.wallet,
       f.coin,
       f.side,
       f.price,
       f.size,
       f.notional,
       f.closed_pnl,
       f.time,
       wc.pnl_tier,
       wc.size_tier,
       wm.total_pnl
     FROM trading.fills f
     JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
     LEFT JOIN trading.wallet_metrics wm ON f.wallet = wm.wallet
     WHERE f.time > NOW() - ($1 || ' hours')::INTERVAL
       AND f.notional >= $2
       AND wc.size_tier IN ('whale', 'leviathan')
     ORDER BY f.notional DESC
     LIMIT $3`,
    [args.hours, args.min_notional, args.limit]
  );

  return {
    hours: args.hours,
    minNotional: args.min_notional,
    alertCount: fills.length,
    alerts: fills.map((f: Record<string, unknown>) => ({
      wallet: f.wallet,
      coin: f.coin,
      side: f.side,
      price: Number(f.price),
      size: Number(f.size),
      notional: Number(f.notional),
      closedPnl: Number(f.closed_pnl),
      pnlTier: f.pnl_tier,
      sizeTier: f.size_tier,
      walletTotalPnl: Number(f.total_pnl),
      time: f.time,
    })),
  };
}

// ─── Tool 4: position_lifecycle ──────────────────────────

export const positionLifecycleSchema = z.object({
  address: z.string().describe('Wallet address'),
  coin: z.string().describe('Coin to trace'),
  days: z.number().default(30).describe('Lookback days'),
});

export async function positionLifecycle(
  args: z.infer<typeof positionLifecycleSchema>
) {
  const wallet = args.address.toLowerCase();
  const coin = args.coin.toUpperCase();

  const fills = await query(
    `SELECT side, price, size, notional, closed_pnl, fee, time
     FROM trading.fills
     WHERE wallet = $1
       AND coin = $2
       AND time > NOW() - ($3 || ' days')::INTERVAL
     ORDER BY time ASC`,
    [wallet, coin, args.days]
  );

  // Build position lifecycle events
  let runningSize = 0;
  let avgEntry = 0;
  let totalPnl = 0;
  const events = fills.map((f: Record<string, unknown>) => {
    const size = Number(f.size);
    const price = Number(f.price);
    const pnl = Number(f.closed_pnl);
    totalPnl += pnl;

    const isBuy = f.side === 'Buy';
    if (isBuy) {
      const newTotal = runningSize + size;
      avgEntry =
        newTotal > 0
          ? (avgEntry * runningSize + price * size) / newTotal
          : price;
      runningSize = newTotal;
    } else {
      runningSize = Math.max(0, runningSize - size);
    }

    return {
      action: isBuy ? 'OPEN/ADD' : 'CLOSE/REDUCE',
      side: f.side,
      price,
      size,
      notional: Number(f.notional),
      closedPnl: pnl,
      runningSize: Math.round(runningSize * 1e8) / 1e8,
      avgEntry: Math.round(avgEntry * 100) / 100,
      time: f.time,
    };
  });

  return {
    wallet,
    coin,
    totalFills: events.length,
    totalPnl: Math.round(totalPnl * 100) / 100,
    currentSize: Math.round(runningSize * 1e8) / 1e8,
    events,
  };
}

// ─── Tool 5: aggregated_flow ─────────────────────────────

export const aggregatedFlowSchema = z.object({
  hours: z.number().default(24).describe('Lookback hours'),
  granularity: z
    .enum(['5m', '15m', '1h', '4h'])
    .default('1h')
    .describe('Time bucket granularity'),
});

export async function aggregatedFlow(
  args: z.infer<typeof aggregatedFlowSchema>
) {
  const intervalMap: Record<string, string> = {
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '4h': '4 hours',
  };

  const timeseries = await query(
    `SELECT
       time_bucket($1::INTERVAL, time) AS bucket,
       SUM(CASE WHEN side = 'Buy' THEN size * price ELSE 0 END) AS buy_volume,
       SUM(CASE WHEN side = 'Sell' THEN size * price ELSE 0 END) AS sell_volume,
       SUM(CASE WHEN side = 'Buy' THEN size * price ELSE -(size * price) END) AS net_flow,
       COUNT(*) AS trade_count
     FROM trading.market_trades
     WHERE time > NOW() - ($2 || ' hours')::INTERVAL
     GROUP BY bucket
     ORDER BY bucket`,
    [intervalMap[args.granularity], args.hours]
  );

  let cumFlow = 0;
  const data = timeseries.map((row: Record<string, unknown>) => {
    const net = Number(row.net_flow);
    cumFlow += net;
    return {
      timestamp: row.bucket,
      buyVolume: Number(row.buy_volume),
      sellVolume: Number(row.sell_volume),
      netFlow: net,
      cumulativeFlow: Math.round(cumFlow * 100) / 100,
      tradeCount: Number(row.trade_count),
    };
  });

  return {
    hours: args.hours,
    granularity: args.granularity,
    dataPoints: data.length,
    timeseries: data,
  };
}

// ─── Tool 6: flow_by_cohort ─────────────────────────────

export const flowByCohortSchema = z.object({
  coin: z.string().optional().describe('Filter by coin'),
  hours: z.number().default(24).describe('Lookback hours'),
});

export async function flowByCohort(
  args: z.infer<typeof flowByCohortSchema>
) {
  const conditions = [`f.time > NOW() - ($1 || ' hours')::INTERVAL`];
  const params: unknown[] = [args.hours];
  let paramIdx = 2;

  if (args.coin) {
    conditions.push(`f.coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  const flows = await query(
    `SELECT
       wc.pnl_tier,
       wc.size_tier,
       SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE 0 END) AS buy_volume,
       SUM(CASE WHEN f.side = 'Sell' THEN f.notional ELSE 0 END) AS sell_volume,
       SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE -f.notional END) AS net_flow,
       COUNT(*) AS trade_count,
       COUNT(DISTINCT f.wallet) AS unique_wallets
     FROM trading.fills f
     JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
     WHERE ${conditions.join(' AND ')}
     GROUP BY wc.pnl_tier, wc.size_tier
     ORDER BY ABS(SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE -f.notional END)) DESC`,
    params
  );

  return {
    coin: args.coin || 'ALL',
    hours: args.hours,
    cohorts: flows.map((f: Record<string, unknown>) => ({
      pnlTier: f.pnl_tier,
      sizeTier: f.size_tier,
      buyVolume: Number(f.buy_volume),
      sellVolume: Number(f.sell_volume),
      netFlow: Number(f.net_flow),
      tradeCount: Number(f.trade_count),
      uniqueWallets: Number(f.unique_wallets),
      bias: Number(f.net_flow) > 0 ? 'BUYING' : 'SELLING',
    })),
  };
}
