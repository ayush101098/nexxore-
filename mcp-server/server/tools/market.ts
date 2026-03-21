/**
 * Market Intelligence Tools (6 tools)
 *
 * 1. funding_rate_scanner   — Top/bottom funding rates across coins
 * 2. liquidation_heatmap    — Recent liquidations by coin & price zone
 * 3. volume_profile         — Volume distribution by price level
 * 4. order_book_depth       — Latest order book snapshot for a coin
 * 5. long_short_ratio       — Aggregate long vs short across all wallets
 * 6. market_overview        — High-level market snapshot (top coins by volume/OI)
 */

import { z } from 'zod';
import { query, queryOne } from '../db.js';

// ─── Tool 1: funding_rate_scanner ────────────────────────

export const fundingRateSchema = z.object({
  sort: z
    .enum(['highest', 'lowest', 'absolute'])
    .default('absolute')
    .describe('How to sort funding rates'),
  limit: z.number().default(20),
});

export async function fundingRateScanner(
  args: z.infer<typeof fundingRateSchema>
) {
  const orderClause =
    args.sort === 'highest'
      ? 'rate DESC'
      : args.sort === 'lowest'
      ? 'rate ASC'
      : 'ABS(rate) DESC';

  const rates = await query(
    `SELECT DISTINCT ON (coin)
       coin,
       rate,
       premium,
       time
     FROM trading.funding_rates
     ORDER BY coin, time DESC`,
    []
  );

  // Sort in application layer after DISTINCT ON
  const sorted = rates
    .map((r: Record<string, unknown>) => ({
      coin: r.coin as string,
      rate: Number(r.rate),
      premium: Number(r.premium),
      annualizedRate: Math.round(Number(r.rate) * 8760 * 10000) / 100, // hourly → annual %
      time: r.time,
    }))
    .sort((a, b) => {
      if (args.sort === 'highest') return b.rate - a.rate;
      if (args.sort === 'lowest') return a.rate - b.rate;
      return Math.abs(b.rate) - Math.abs(a.rate);
    })
    .slice(0, args.limit);

  return {
    count: sorted.length,
    sort: args.sort,
    rates: sorted,
  };
}

// ─── Tool 2: liquidation_heatmap ─────────────────────────

export const liquidationHeatmapSchema = z.object({
  coin: z.string().optional().describe('Filter by coin'),
  hours: z.number().default(24).describe('Lookback hours'),
  limit: z.number().default(50),
});

export async function liquidationHeatmap(
  args: z.infer<typeof liquidationHeatmapSchema>
) {
  const conditions = [`time > NOW() - ($1 || ' hours')::INTERVAL`];
  const params: unknown[] = [args.hours];
  let paramIdx = 2;

  if (args.coin) {
    conditions.push(`coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  params.push(args.limit);

  const liqs = await query(
    `SELECT
       coin,
       side,
       price,
       size,
       notional,
       leverage,
       wallet,
       time
     FROM trading.liquidations
     WHERE ${conditions.join(' AND ')}
     ORDER BY notional DESC
     LIMIT $${paramIdx}`,
    params
  );

  // Aggregate by coin
  const byCoin: Record<string, { longLiqs: number; shortLiqs: number; totalNotional: number; count: number }> = {};
  for (const l of liqs) {
    const rec = l as Record<string, unknown>;
    const coin = rec.coin as string;
    if (!byCoin[coin]) {
      byCoin[coin] = { longLiqs: 0, shortLiqs: 0, totalNotional: 0, count: 0 };
    }
    const notional = Number(rec.notional);
    byCoin[coin].totalNotional += notional;
    byCoin[coin].count += 1;
    if (rec.side === 'long') byCoin[coin].longLiqs += notional;
    else byCoin[coin].shortLiqs += notional;
  }

  return {
    hours: args.hours,
    totalLiquidations: liqs.length,
    byCoin: Object.entries(byCoin)
      .map(([coin, stats]) => ({ coin, ...stats }))
      .sort((a, b) => b.totalNotional - a.totalNotional),
    largest: liqs.slice(0, 10).map((l: Record<string, unknown>) => ({
      coin: l.coin,
      side: l.side,
      price: Number(l.price),
      notional: Number(l.notional),
      leverage: Number(l.leverage),
      time: l.time,
    })),
  };
}

// ─── Tool 3: volume_profile ──────────────────────────────

export const volumeProfileSchema = z.object({
  coin: z.string().describe('Coin to analyze'),
  hours: z.number().default(24).describe('Lookback hours'),
  buckets: z.number().default(20).describe('Number of price buckets'),
});

export async function volumeProfile(
  args: z.infer<typeof volumeProfileSchema>
) {
  const coin = args.coin.toUpperCase();

  // Get price range
  const range = await queryOne(
    `SELECT MIN(price) AS min_price, MAX(price) AS max_price
     FROM trading.market_trades
     WHERE coin = $1 AND time > NOW() - ($2 || ' hours')::INTERVAL`,
    [coin, args.hours]
  );

  if (!range || !range.min_price) {
    return { error: `No trade data found for ${coin}` };
  }

  const minPrice = Number(range.min_price);
  const maxPrice = Number(range.max_price);
  const bucketSize = (maxPrice - minPrice) / args.buckets;

  if (bucketSize <= 0) {
    return { coin, buckets: [], note: 'Price range too narrow' };
  }

  const profile = await query(
    `SELECT
       FLOOR((price - $3) / $4) AS bucket_idx,
       $3 + FLOOR((price - $3) / $4) * $4 AS bucket_low,
       $3 + (FLOOR((price - $3) / $4) + 1) * $4 AS bucket_high,
       COUNT(*) AS trade_count,
       SUM(size) AS total_size,
       SUM(size * price) AS total_notional,
       SUM(CASE WHEN side = 'Buy' THEN size ELSE 0 END) AS buy_size,
       SUM(CASE WHEN side = 'Sell' THEN size ELSE 0 END) AS sell_size
     FROM trading.market_trades
     WHERE coin = $1
       AND time > NOW() - ($2 || ' hours')::INTERVAL
     GROUP BY bucket_idx, bucket_low, bucket_high
     ORDER BY bucket_idx`,
    [coin, args.hours, minPrice, bucketSize]
  );

  return {
    coin,
    hours: args.hours,
    priceRange: { min: minPrice, max: maxPrice },
    buckets: profile.map((b: Record<string, unknown>) => ({
      priceLow: Number(b.bucket_low),
      priceHigh: Number(b.bucket_high),
      tradeCount: Number(b.trade_count),
      totalSize: Number(b.total_size),
      totalNotional: Number(b.total_notional),
      buySize: Number(b.buy_size),
      sellSize: Number(b.sell_size),
    })),
  };
}

// ─── Tool 4: order_book_depth ────────────────────────────

export const orderBookSchema = z.object({
  coin: z.string().describe('Coin to get order book for'),
});

export async function orderBookDepth(
  args: z.infer<typeof orderBookSchema>
) {
  const coin = args.coin.toUpperCase();

  const snapshot = await queryOne(
    `SELECT bids, asks, mid_price, spread, time
     FROM trading.orderbook_snapshots
     WHERE coin = $1
     ORDER BY time DESC
     LIMIT 1`,
    [coin]
  );

  if (!snapshot) {
    return { error: `No order book data for ${coin}` };
  }

  const bids = (snapshot.bids as Array<{ price: number; size: number }>) || [];
  const asks = (snapshot.asks as Array<{ price: number; size: number }>) || [];

  const bidDepth = bids.reduce((s, b) => s + b.size * b.price, 0);
  const askDepth = asks.reduce((s, a) => s + a.size * a.price, 0);

  return {
    coin,
    midPrice: Number(snapshot.mid_price),
    spread: Number(snapshot.spread),
    bidDepth,
    askDepth,
    imbalance:
      bidDepth + askDepth > 0
        ? Math.round(((bidDepth - askDepth) / (bidDepth + askDepth)) * 10000) /
          100
        : 0,
    bids: bids.slice(0, 10),
    asks: asks.slice(0, 10),
    snapshotTime: snapshot.time,
  };
}

// ─── Tool 5: long_short_ratio ────────────────────────────

export const longShortSchema = z.object({
  coin: z.string().optional().describe('Filter by coin'),
  pnl_tier: z
    .enum(['money_printer', 'profitable', 'breakeven', 'losing', 'giga_rekt'])
    .optional(),
});

export async function longShortRatio(
  args: z.infer<typeof longShortSchema>
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (args.coin) {
    conditions.push(`p.coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }
  if (args.pnl_tier) {
    conditions.push(`wc.pnl_tier = $${paramIdx++}`);
    params.push(args.pnl_tier);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const ratios = await query(
    `SELECT
       p.coin,
       COUNT(*) FILTER (WHERE p.side = 'long') AS long_accounts,
       COUNT(*) FILTER (WHERE p.side = 'short') AS short_accounts,
       COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'long'), 0) AS long_notional,
       COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'short'), 0) AS short_notional
     FROM trading.positions p
     LEFT JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
     ${whereClause}
     GROUP BY p.coin
     ORDER BY (COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'long'), 0)
             + COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'short'), 0)) DESC`,
    params
  );

  return {
    coin: args.coin || 'ALL',
    pnlTier: args.pnl_tier || 'ALL',
    coins: ratios.map((r: Record<string, unknown>) => {
      const longN = Number(r.long_notional);
      const shortN = Number(r.short_notional);
      return {
        coin: r.coin,
        longAccounts: Number(r.long_accounts),
        shortAccounts: Number(r.short_accounts),
        longNotional: longN,
        shortNotional: shortN,
        ratio: shortN > 0 ? Math.round((longN / shortN) * 100) / 100 : Infinity,
        bias: longN > shortN ? 'LONG' : shortN > longN ? 'SHORT' : 'NEUTRAL',
      };
    }),
  };
}

// ─── Tool 6: market_overview ─────────────────────────────

export const marketOverviewSchema = z.object({
  hours: z.number().default(24).describe('Lookback hours for volume'),
  limit: z.number().default(20).describe('Top N coins'),
});

export async function marketOverview(
  args: z.infer<typeof marketOverviewSchema>
) {
  const [volumeLeaders, positionLeaders, recentFunding] = await Promise.all([
    query(
      `SELECT
         coin,
         COUNT(*) AS trade_count,
         SUM(size * price) AS total_volume,
         MIN(price) AS low,
         MAX(price) AS high,
         (ARRAY_AGG(price ORDER BY time DESC))[1] AS last_price,
         (ARRAY_AGG(price ORDER BY time ASC))[1] AS open_price
       FROM trading.market_trades
       WHERE time > NOW() - ($1 || ' hours')::INTERVAL
       GROUP BY coin
       ORDER BY SUM(size * price) DESC
       LIMIT $2`,
      [args.hours, args.limit]
    ),
    query(
      `SELECT
         coin,
         SUM(size * entry_price) AS open_interest,
         COUNT(DISTINCT wallet) AS unique_holders,
         AVG(leverage) AS avg_leverage
       FROM trading.positions
       GROUP BY coin
       ORDER BY SUM(size * entry_price) DESC
       LIMIT $1`,
      [args.limit]
    ),
    query(
      `SELECT DISTINCT ON (coin) coin, rate, time
       FROM trading.funding_rates
       ORDER BY coin, time DESC`,
      []
    ),
  ]);

  // Build funding map
  const fundingMap: Record<string, number> = {};
  for (const fr of recentFunding) {
    const rec = fr as Record<string, unknown>;
    fundingMap[rec.coin as string] = Number(rec.rate);
  }

  // Build OI map
  const oiMap: Record<string, { oi: number; holders: number; avgLev: number }> =
    {};
  for (const p of positionLeaders) {
    const rec = p as Record<string, unknown>;
    oiMap[rec.coin as string] = {
      oi: Number(rec.open_interest),
      holders: Number(rec.unique_holders),
      avgLev: Number(rec.avg_leverage),
    };
  }

  return {
    hours: args.hours,
    coins: volumeLeaders.map((v: Record<string, unknown>) => {
      const coin = v.coin as string;
      const lastPrice = Number(v.last_price);
      const openPrice = Number(v.open_price);
      const oi = oiMap[coin];
      return {
        coin,
        volume: Number(v.total_volume),
        tradeCount: Number(v.trade_count),
        lastPrice,
        openPrice,
        high: Number(v.high),
        low: Number(v.low),
        change: openPrice > 0
          ? Math.round(((lastPrice - openPrice) / openPrice) * 10000) / 100
          : 0,
        openInterest: oi?.oi || 0,
        uniqueHolders: oi?.holders || 0,
        avgLeverage: oi?.avgLev || 0,
        fundingRate: fundingMap[coin] || 0,
      };
    }),
  };
}
