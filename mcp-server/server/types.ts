/**
 * Shared TypeScript types for the MCP server.
 */

// ── Cohort tiers ────────────────────────────────────────

export type PnlTier = 'money_printer' | 'profitable' | 'breakeven' | 'losing' | 'giga_rekt';
export type SizeTier = 'leviathan' | 'whale' | 'dolphin' | 'fish' | 'shrimp';
export type Consistency = 'consistent' | 'moderate' | 'erratic';
export type TradingStyle = 'scalper' | 'swing' | 'position' | 'mixed';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive' | 'degen';

// ── Wallet types ────────────────────────────────────────

export interface WalletMetrics {
  wallet: string;
  totalPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalVolume: number;
  totalFees: number;
  largestWin: number;
  largestLoss: number;
  avgTradeSize: number;
  profitFactor: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  avgLeverage: number | null;
  uniqueCoinsTraded: number;
  activeSince: string | null;
  lastTrade: string | null;
}

export interface WalletCohort {
  wallet: string;
  pnlTier: PnlTier;
  sizeTier: SizeTier;
  consistency: Consistency | null;
  style: TradingStyle | null;
  riskProfile: RiskProfile | null;
}

export interface TraderProfile extends WalletMetrics {
  pnlTier: PnlTier;
  sizeTier: SizeTier;
  consistency: Consistency | null;
  style: TradingStyle | null;
  riskProfile: RiskProfile | null;
}

// ── Position types ──────────────────────────────────────

export interface Position {
  wallet: string;
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
  marginUsed: number | null;
  returnOnEquity: number | null;
}

// ── Trade types ─────────────────────────────────────────

export interface Fill {
  time: string;
  coin: string;
  wallet: string;
  side: string;
  price: number;
  size: number;
  notional: number;
  fee: number;
  closedPnl: number;
  direction: string | null;
  isLiquidation: boolean;
}

export interface MarketTrade {
  time: string;
  coin: string;
  side: string;
  price: number;
  size: number;
  notional: number;
}

// ── Market data types ───────────────────────────────────

export interface FundingRate {
  time: string;
  coin: string;
  fundingRate: number;
  premium: number | null;
  openInterest: number | null;
  markPrice: number | null;
}

export interface OrderBookSnapshot {
  time: string;
  coin: string;
  bidDepth: number | null;
  askDepth: number | null;
  spread: number | null;
  midPrice: number | null;
  imbalance: number | null;
}

export interface AssetInfo {
  coin: string;
  assetIndex: number | null;
  maxLeverage: number | null;
  markPrice: number | null;
  midPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  volume24h: number | null;
}

// ── Cohort analysis types ───────────────────────────────

export interface CohortBias {
  coin: string;
  tier: string;
  longCount: number;
  shortCount: number;
  longNotional: number;
  shortNotional: number;
  netBias: 'long' | 'short' | 'neutral';
  biasRatio: number;
}

export interface CohortFlow {
  tier: string;
  netFlow: number;
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  uniqueWallets: number;
}
