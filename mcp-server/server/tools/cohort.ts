/**
 * Cohort Intelligence Tools (4 tools)
 *
 * 1. classify_wallet       — Classify a wallet into behavioral tiers
 * 2. get_cohort_positions  — What wallets in a cohort are holding right now
 * 3. live_cohort_bias      — Long/short bias by cohort for a coin
 * 4. cohort_flow_analysis  — Net flow analysis by cohort tier
 */

import { z } from 'zod';
import { query, queryOne } from '../db.js';

// ─── Tool 1: classify_wallet ─────────────────────────────

export const classifyWalletSchema = z.object({
  address: z.string().describe('Ethereum wallet address (0x...)'),
});

export async function classifyWallet(
  args: z.infer<typeof classifyWalletSchema>
) {
  const wallet = args.address.toLowerCase();

  // Get metrics + cohort in one shot
  const profile = await queryOne(
    `SELECT
       wm.wallet,
       wm.total_pnl,
       wm.trade_count,
       wm.win_count,
       wm.loss_count,
       wm.win_rate,
       wm.total_volume,
       wm.total_fees,
       wm.largest_win,
       wm.largest_loss,
       wm.avg_trade_size,
       wm.profit_factor,
       wm.sharpe_ratio,
       wm.max_drawdown,
       wm.unique_coins_traded,
       wm.active_since,
       wm.last_trade,
       wc.pnl_tier,
       wc.size_tier,
       wc.consistency,
       wc.style,
       wc.risk_profile
     FROM trading.wallet_metrics wm
     LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
     WHERE wm.wallet = $1`,
    [wallet]
  );

  if (!profile) {
    return { error: `No data found for wallet ${args.address}` };
  }

  return {
    address: profile.wallet,
    totalPnl: Number(profile.total_pnl),
    tradeCount: Number(profile.trade_count),
    winRate: Number(profile.win_rate),
    totalVolume: Number(profile.total_volume),
    largestWin: Number(profile.largest_win),
    largestLoss: Number(profile.largest_loss),
    profitFactor: Number(profile.profit_factor),
    pnlTier: profile.pnl_tier || 'unclassified',
    sizeTier: profile.size_tier || 'unclassified',
    consistency: profile.consistency,
    style: profile.style,
    riskProfile: profile.risk_profile,
    activeSince: profile.active_since,
    lastTrade: profile.last_trade,
  };
}

// ─── Tool 2: get_cohort_positions ────────────────────────

export const cohortPositionsSchema = z.object({
  pnl_tier: z
    .enum(['money_printer', 'profitable', 'breakeven', 'losing', 'giga_rekt'])
    .optional()
    .describe('PnL tier to filter by'),
  size_tier: z
    .enum(['leviathan', 'whale', 'dolphin', 'fish', 'shrimp'])
    .optional()
    .describe('Size tier to filter by'),
  coin: z.string().optional().describe('Filter by coin (e.g. BTC, ETH)'),
  limit: z.number().default(50).describe('Max results to return'),
});

export async function getCohortPositions(
  args: z.infer<typeof cohortPositionsSchema>
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (args.pnl_tier) {
    conditions.push(`wc.pnl_tier = $${paramIdx++}`);
    params.push(args.pnl_tier);
  }
  if (args.size_tier) {
    conditions.push(`wc.size_tier = $${paramIdx++}`);
    params.push(args.size_tier);
  }
  if (args.coin) {
    conditions.push(`p.coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(args.limit);

  const positions = await query(
    `SELECT
       p.wallet,
       p.coin,
       p.side,
       p.size,
       p.entry_price,
       p.mark_price,
       p.unrealized_pnl,
       p.leverage,
       p.liquidation_price,
       wc.pnl_tier,
       wc.size_tier
     FROM trading.positions p
     JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
     ${whereClause}
     ORDER BY (p.size * p.entry_price) DESC
     LIMIT $${paramIdx}`,
    params
  );

  return {
    count: positions.length,
    positions: positions.map((p: Record<string, unknown>) => ({
      wallet: p.wallet,
      coin: p.coin,
      side: p.side,
      size: Number(p.size),
      entryPrice: Number(p.entry_price),
      markPrice: Number(p.mark_price),
      unrealizedPnl: Number(p.unrealized_pnl),
      leverage: Number(p.leverage),
      pnlTier: p.pnl_tier,
      sizeTier: p.size_tier,
    })),
  };
}

// ─── Tool 3: live_cohort_bias ────────────────────────────

export const cohortBiasSchema = z.object({
  coin: z.string().describe('Coin to check bias for (e.g. ETH, BTC)'),
});

export async function liveCohortBias(
  args: z.infer<typeof cohortBiasSchema>
) {
  const coin = args.coin.toUpperCase();

  const tiers = await query(
    `SELECT
       wc.pnl_tier AS tier,
       COUNT(*) FILTER (WHERE p.side = 'long')  AS long_count,
       COUNT(*) FILTER (WHERE p.side = 'short') AS short_count,
       COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'long'), 0) AS long_notional,
       COALESCE(SUM(p.size * p.entry_price) FILTER (WHERE p.side = 'short'), 0) AS short_notional
     FROM trading.positions p
     JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
     WHERE p.coin = $1
     GROUP BY wc.pnl_tier
     ORDER BY
       CASE wc.pnl_tier
         WHEN 'money_printer' THEN 1
         WHEN 'profitable' THEN 2
         WHEN 'breakeven' THEN 3
         WHEN 'losing' THEN 4
         WHEN 'giga_rekt' THEN 5
       END`,
    [coin]
  );

  return {
    coin,
    tiers: tiers.map((t: Record<string, unknown>) => {
      const longN = Number(t.long_notional);
      const shortN = Number(t.short_notional);
      const total = longN + shortN;
      return {
        tier: t.tier,
        longCount: Number(t.long_count),
        shortCount: Number(t.short_count),
        longNotional: longN,
        shortNotional: shortN,
        netBias: longN > shortN ? 'long' : shortN > longN ? 'short' : 'neutral',
        biasRatio: total > 0 ? Math.round(((longN - shortN) / total) * 100) / 100 : 0,
      };
    }),
  };
}

// ─── Tool 4: cohort_flow_analysis ────────────────────────

export const cohortFlowSchema = z.object({
  hours: z.number().default(24).describe('Lookback period in hours'),
  coin: z.string().optional().describe('Filter by coin'),
});

export async function cohortFlowAnalysis(
  args: z.infer<typeof cohortFlowSchema>
) {
  const conditions = ["f.time > NOW() - ($1 || ' hours')::INTERVAL"];
  const params: unknown[] = [args.hours];
  let paramIdx = 2;

  if (args.coin) {
    conditions.push(`f.coin = $${paramIdx++}`);
    params.push(args.coin.toUpperCase());
  }

  const whereClause = conditions.join(' AND ');

  const flows = await query(
    `SELECT
       wc.pnl_tier AS tier,
       SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE 0 END) AS buy_volume,
       SUM(CASE WHEN f.side = 'Sell' THEN f.notional ELSE 0 END) AS sell_volume,
       SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE -f.notional END) AS net_flow,
       COUNT(*) AS trade_count,
       COUNT(DISTINCT f.wallet) AS unique_wallets
     FROM trading.fills f
     JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
     WHERE ${whereClause}
     GROUP BY wc.pnl_tier
     ORDER BY ABS(SUM(CASE WHEN f.side = 'Buy' THEN f.notional ELSE -f.notional END)) DESC`,
    params
  );

  return {
    hours: args.hours,
    coin: args.coin || 'ALL',
    flows: flows.map((f: Record<string, unknown>) => ({
      tier: f.tier,
      buyVolume: Number(f.buy_volume),
      sellVolume: Number(f.sell_volume),
      netFlow: Number(f.net_flow),
      tradeCount: Number(f.trade_count),
      uniqueWallets: Number(f.unique_wallets),
    })),
  };
}
