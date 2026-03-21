/**
 * Nexxore Hyperliquid MCP Server
 *
 * 26 tools across 4 categories:
 *   Cohort Intelligence  (4)  — classify_wallet, get_cohort_positions,
 *                                live_cohort_bias, cohort_flow_analysis
 *   Trader Analytics     (10) — pulse_trader_profile, rank_traders,
 *                                trader_positions, trader_history,
 *                                trader_pnl_breakdown, hidden_gem_discovery,
 *                                trader_comparison, trader_risk_analysis,
 *                                trader_coin_exposure, trader_performance_over_time
 *   Market Intelligence  (6)  — funding_rate_scanner, liquidation_heatmap,
 *                                volume_profile, order_book_depth,
 *                                long_short_ratio, market_overview
 *   Real-Time Trade Flow (6)  — largest_trades, trade_flow_summary,
 *                                whale_alert, position_lifecycle,
 *                                aggregated_flow, flow_by_cohort
 *
 * Transport: stdio (standard MCP protocol)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pool } from './db.js';

// ─── Cohort Intelligence ─────────────────────────────────
import {
  classifyWalletSchema,
  classifyWallet,
  cohortPositionsSchema,
  getCohortPositions,
  cohortBiasSchema,
  liveCohortBias,
  cohortFlowSchema,
  cohortFlowAnalysis,
} from './tools/cohort.js';

// ─── Trader Analytics ────────────────────────────────────
import {
  traderProfileSchema,
  pulseTraderProfile,
  rankTradersSchema,
  rankTraders,
  traderPositionsSchema,
  traderPositions,
  traderHistorySchema,
  traderHistory,
  pnlBreakdownSchema,
  traderPnlBreakdown,
  hiddenGemSchema,
  hiddenGemDiscovery,
  traderComparisonSchema,
  traderComparison,
  riskAnalysisSchema,
  traderRiskAnalysis,
  coinExposureSchema,
  traderCoinExposure,
  perfOverTimeSchema,
  traderPerformanceOverTime,
} from './tools/trader.js';

// ─── Market Intelligence ─────────────────────────────────
import {
  fundingRateSchema,
  fundingRateScanner,
  liquidationHeatmapSchema,
  liquidationHeatmap,
  volumeProfileSchema,
  volumeProfile,
  orderBookSchema,
  orderBookDepth,
  longShortSchema,
  longShortRatio,
  marketOverviewSchema,
  marketOverview,
} from './tools/market.js';

// ─── Real-Time Trade Flow ────────────────────────────────
import {
  largestTradesSchema,
  largestTrades,
  tradeFlowSchema,
  tradeFlowSummary,
  whaleAlertSchema,
  whaleAlert,
  positionLifecycleSchema,
  positionLifecycle,
  aggregatedFlowSchema,
  aggregatedFlow,
  flowByCohortSchema,
  flowByCohort,
} from './tools/flow.js';

// ─── Server Setup ────────────────────────────────────────

const server = new McpServer({
  name: 'nexxore-hyperliquid',
  version: '1.0.0',
});

// ═════════════════════════════════════════════════════════
//  COHORT INTELLIGENCE (4 tools)
// ═════════════════════════════════════════════════════════

server.tool(
  'classify_wallet',
  'Classify a wallet into behavioral tiers (PnL, Size, Consistency, Style, Risk)',
  classifyWalletSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await classifyWallet(args), null, 2) }],
  })
);

server.tool(
  'get_cohort_positions',
  'Get current positions held by wallets in a specific cohort tier',
  cohortPositionsSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await getCohortPositions(args), null, 2) }],
  })
);

server.tool(
  'live_cohort_bias',
  'Show long/short bias for a coin broken down by PnL cohort tier',
  cohortBiasSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await liveCohortBias(args), null, 2) }],
  })
);

server.tool(
  'cohort_flow_analysis',
  'Analyze net buy/sell dollar flow by cohort tier over a time window',
  cohortFlowSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await cohortFlowAnalysis(args), null, 2) }],
  })
);

// ═════════════════════════════════════════════════════════
//  TRADER ANALYTICS (10 tools)
// ═════════════════════════════════════════════════════════

server.tool(
  'pulse_trader_profile',
  'Full trader profile — metrics, cohort tiers, open positions, and recent fills',
  traderProfileSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await pulseTraderProfile(args), null, 2) }],
  })
);

server.tool(
  'rank_traders',
  'Leaderboard of traders ranked by any metric (PnL, win rate, volume, etc.)',
  rankTradersSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await rankTraders(args), null, 2) }],
  })
);

server.tool(
  'trader_positions',
  'Get all current open positions for a specific wallet',
  traderPositionsSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderPositions(args), null, 2) }],
  })
);

server.tool(
  'trader_history',
  'Recent fills / trade log for a wallet with optional coin & time filters',
  traderHistorySchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderHistory(args), null, 2) }],
  })
);

server.tool(
  'trader_pnl_breakdown',
  'PnL breakdown by coin for a wallet — see which coins are profitable/losing',
  pnlBreakdownSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderPnlBreakdown(args), null, 2) }],
  })
);

server.tool(
  'hidden_gem_discovery',
  'Find small but consistently profitable wallets that fly under the radar',
  hiddenGemSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await hiddenGemDiscovery(args), null, 2) }],
  })
);

server.tool(
  'trader_comparison',
  'Head-to-head comparison of 2-5 wallets across all metrics',
  traderComparisonSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderComparison(args), null, 2) }],
  })
);

server.tool(
  'trader_risk_analysis',
  'Risk assessment — drawdown, leverage stats, position concentration, and risk rating',
  riskAnalysisSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderRiskAnalysis(args), null, 2) }],
  })
);

server.tool(
  'trader_coin_exposure',
  'Notional exposure breakdown by coin for a wallet (long vs short)',
  coinExposureSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderCoinExposure(args), null, 2) }],
  })
);

server.tool(
  'trader_performance_over_time',
  'Daily/hourly PnL timeseries with cumulative curve for a wallet',
  perfOverTimeSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await traderPerformanceOverTime(args), null, 2) }],
  })
);

// ═════════════════════════════════════════════════════════
//  MARKET INTELLIGENCE (6 tools)
// ═════════════════════════════════════════════════════════

server.tool(
  'funding_rate_scanner',
  'Scan all coins for highest/lowest funding rates with annualized projections',
  fundingRateSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await fundingRateScanner(args), null, 2) }],
  })
);

server.tool(
  'liquidation_heatmap',
  'Recent liquidations broken down by coin, side, and size',
  liquidationHeatmapSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await liquidationHeatmap(args), null, 2) }],
  })
);

server.tool(
  'volume_profile',
  'Volume distribution across price levels for a coin (market profile)',
  volumeProfileSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await volumeProfile(args), null, 2) }],
  })
);

server.tool(
  'order_book_depth',
  'Latest order book snapshot — bid/ask depth, spread, and imbalance',
  orderBookSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await orderBookDepth(args), null, 2) }],
  })
);

server.tool(
  'long_short_ratio',
  'Aggregate long vs short positions across all wallets, optionally filtered by cohort',
  longShortSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await longShortRatio(args), null, 2) }],
  })
);

server.tool(
  'market_overview',
  'High-level market snapshot — top coins by volume, OI, price change, and funding',
  marketOverviewSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await marketOverview(args), null, 2) }],
  })
);

// ═════════════════════════════════════════════════════════
//  REAL-TIME TRADE FLOW (6 tools)
// ═════════════════════════════════════════════════════════

server.tool(
  'largest_trades',
  'Biggest trades by notional value in a time window',
  largestTradesSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await largestTrades(args), null, 2) }],
  })
);

server.tool(
  'trade_flow_summary',
  'Aggregated buy/sell flow per coin — volume, count, and net flow',
  tradeFlowSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await tradeFlowSummary(args), null, 2) }],
  })
);

server.tool(
  'whale_alert',
  'Large fills from whale/leviathan-tier wallets',
  whaleAlertSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await whaleAlert(args), null, 2) }],
  })
);

server.tool(
  'position_lifecycle',
  'Trace a wallet\'s position lifecycle for a coin — every open, add, reduce, close',
  positionLifecycleSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await positionLifecycle(args), null, 2) }],
  })
);

server.tool(
  'aggregated_flow',
  'Net dollar flow across all coins in time buckets (5m/15m/1h/4h)',
  aggregatedFlowSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await aggregatedFlow(args), null, 2) }],
  })
);

server.tool(
  'flow_by_cohort',
  'Trade flow broken down by PnL tier and size tier — see what smart money is doing',
  flowByCohortSchema.shape,
  async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await flowByCohort(args), null, 2) }],
  })
);

// ─── Start ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nexxore-mcp] Server running on stdio — 26 tools registered');
}

main().catch((err) => {
  console.error('[nexxore-mcp] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('[nexxore-mcp] Shutting down...');
  await pool.end();
  process.exit(0);
});
