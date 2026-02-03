require('dotenv').config();

















const config = {
  port: parseInt(process.env.PERPS_PORT || process.env.PORT || '3010', 10),
  databaseUrl: process.env.DATABASE_URL,
  hyperliquidApi: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
  useHyperliquid: process.env.USE_HYPERLIQUID !== 'false',
  wsUpstream: process.env.PERPS_MARKET_WS || 'wss://stream.binance.com:9443/stream',
  // Top 20 HyperLiquid markets
  symbols: (process.env.PERPS_MARKETS || process.env.PERPS_SYMBOLS || 'BTC,ETH,SOL,HYPE,ARB,OP,AVAX,MATIC,DOGE,LINK,UNI,ATOM,LTC,BCH,ETC,FIL,APT,STX,INJ,TIA')
    .split(',')
    .map(s => s.trim().toUpperCase()),
  makerFee: parseFloat(process.env.PERPS_MAKER_FEE || '0.0002'),
  takerFee: parseFloat(process.env.PERPS_TAKER_FEE || '0.0006'),
  maxLeverage: parseInt(process.env.PERPS_MAX_LEVERAGE || '50', 10),
  maintenanceMarginRate: parseFloat(process.env.PERPS_MAINT_MARGIN || '0.005'),
  priceDecimals: {
    BTC: 1,
    ETH: 2,
    SOL: 3,
    HYPE: 4,
    ARB: 4,
    OP: 4,
    AVAX: 3,
    MATIC: 5,
    DOGE: 6,
    LINK: 3,
    UNI: 4,
    ATOM: 3,
    LTC: 2,
    BCH: 2,
    ETC: 3,
    FIL: 4,
    APT: 4,
    STX: 4,
    INJ: 3,
    TIA: 4
  },
  evmRpc: process.env.PERPS_EVM_RPC || process.env.ETHEREUM_RPC || process.env.MAINNET_RPC_URL,
  solanaRpc: process.env.PERPS_SOLANA_RPC || process.env.SOLANA_RPC,
  evmPerpsContract: process.env.PERPS_EVM_CONTRACT,
  solanaPerpsProgram: process.env.PERPS_SOLANA_PROGRAM,
  solanaFeePayerSecret: process.env.PERPS_SOLANA_FEE_PAYER_SECRET,
  solanaCollateralMint: process.env.PERPS_SOLANA_COLLATERAL_MINT,
  solanaVaultAccount: process.env.PERPS_SOLANA_VAULT
};
module.exports = config;

