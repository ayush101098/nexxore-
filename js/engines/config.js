/* Nexxore execution config — commission rates and the vault addresses that
 * receive them. Commission never passes through a Nexxore server: venues pay
 * it straight to these addresses.
 *
 *  hyperliquid.builder  EVM address registered as a Hyperliquid builder. Fees on
 *                       every order placed through Nexxore accrue to it as builder
 *                       rewards (claimable). It must hold ≥ 100 USDC in perps
 *                       account value to act as a builder. Use a multisig-owned address.
 *  hyperliquid.feeTenthsBps  commission in tenths of a basis point (50 = 0.05%). Venue max 1000 (0.1%) for perps.
 *  jupiter.referralAccount   Jupiter referral account (referral.jup.ag, Ultra project) with
 *                       USDC and SOL token accounts initialised; the fee lands there.
 *  jupiter.feeBps       commission on Solana swaps (50–255 bps per Jupiter Ultra rules).
 *  cex.*.url            referral/broker link for each exchange; {SYMBOL} is filled in.
 *                       On centralised exchanges commission is the exchange's referral
 *                       rebate — Nexxore cannot add a fee on top.
 *
 * Empty addresses = no commission is collected (orders still work).
 */
window.NX_CONFIG = {
  hyperliquid: { builder: '', feeTenthsBps: 50 },
  jupiter: { referralAccount: '', feeBps: 50 },
  cex: {
    binance: { name: 'Binance', url: 'https://www.binance.com/en/futures/{SYMBOL}USDT', rebateNote: 'referral rebate' },
    bybit: { name: 'Bybit', url: 'https://www.bybit.com/trade/usdt/{SYMBOL}USDT', rebateNote: 'referral rebate' },
    okx: { name: 'OKX', url: 'https://www.okx.com/trade-swap/{symbol}-usdt-swap', rebateNote: 'referral rebate' }
  },
  maxLeverage: 10,           // Nexxore cap, below each venue's own max
  slippagePct: 0.5           // marketable entry limit, % from mid
};
