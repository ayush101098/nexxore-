/**
 * Programmatic SEO Configuration
 *
 * Central registry of tokens, protocols, and URL patterns used to generate
 * thousands of SEO-optimised pages from on-chain data.
 *
 * Usage:
 *   const config = require('./config');
 *   config.tokens          // full token list (100+)
 *   config.protocols        // full protocol list (50+)
 *   config.stablecoins      // stablecoins for comparison page
 *   config.urlPatterns      // slug → path mappings
 */

// ─── Tokens ─────────────────────────────────────────────────────────────────
// Each entry generates 2 pages: funding-rate + perp-risk
// slug is used in the URL; coingeckoId is used for API calls.

const tokens = [
  // Majors
  { name: 'Bitcoin',    symbol: 'BTC',   slug: 'bitcoin',    coingeckoId: 'bitcoin',    category: 'major' },
  { name: 'Ethereum',   symbol: 'ETH',   slug: 'ethereum',   coingeckoId: 'ethereum',   category: 'major' },
  { name: 'Solana',     symbol: 'SOL',   slug: 'solana',     coingeckoId: 'solana',     category: 'major' },
  { name: 'BNB',        symbol: 'BNB',   slug: 'bnb',        coingeckoId: 'binancecoin', category: 'major' },
  { name: 'XRP',        symbol: 'XRP',   slug: 'xrp',        coingeckoId: 'ripple',     category: 'major' },
  { name: 'Cardano',    symbol: 'ADA',   slug: 'cardano',    coingeckoId: 'cardano',    category: 'major' },
  { name: 'Avalanche',  symbol: 'AVAX',  slug: 'avalanche',  coingeckoId: 'avalanche-2', category: 'major' },
  { name: 'Dogecoin',   symbol: 'DOGE',  slug: 'dogecoin',   coingeckoId: 'dogecoin',   category: 'major' },
  { name: 'Polkadot',   symbol: 'DOT',   slug: 'polkadot',   coingeckoId: 'polkadot',   category: 'major' },
  { name: 'Chainlink',  symbol: 'LINK',  slug: 'chainlink',  coingeckoId: 'chainlink',  category: 'major' },
  { name: 'TRON',       symbol: 'TRX',   slug: 'tron',       coingeckoId: 'tron',       category: 'major' },
  { name: 'Toncoin',    symbol: 'TON',   slug: 'toncoin',    coingeckoId: 'the-open-network', category: 'major' },

  // L2 & Scaling
  { name: 'Arbitrum',   symbol: 'ARB',   slug: 'arbitrum',   coingeckoId: 'arbitrum',   category: 'l2' },
  { name: 'Optimism',   symbol: 'OP',    slug: 'optimism',   coingeckoId: 'optimism',   category: 'l2' },
  { name: 'Polygon',    symbol: 'MATIC', slug: 'polygon',    coingeckoId: 'matic-network', category: 'l2' },
  { name: 'Base',       symbol: 'BASE',  slug: 'base',       coingeckoId: 'base',       category: 'l2' },
  { name: 'Starknet',   symbol: 'STRK',  slug: 'starknet',   coingeckoId: 'starknet',   category: 'l2' },
  { name: 'zkSync Era', symbol: 'ZK',    slug: 'zksync',     coingeckoId: 'zksync',     category: 'l2' },
  { name: 'Scroll',     symbol: 'SCR',   slug: 'scroll',     coingeckoId: 'scroll',     category: 'l2' },
  { name: 'Mantle',     symbol: 'MNT',   slug: 'mantle',     coingeckoId: 'mantle',     category: 'l2' },
  { name: 'Blast',      symbol: 'BLAST', slug: 'blast',      coingeckoId: 'blast',      category: 'l2' },
  { name: 'Linea',      symbol: 'LINEA', slug: 'linea',      coingeckoId: 'linea',      category: 'l2' },

  // DeFi Blue-Chips
  { name: 'Aave',       symbol: 'AAVE',  slug: 'aave',       coingeckoId: 'aave',       category: 'defi' },
  { name: 'Uniswap',    symbol: 'UNI',   slug: 'uniswap',    coingeckoId: 'uniswap',    category: 'defi' },
  { name: 'Lido DAO',   symbol: 'LDO',   slug: 'lido',       coingeckoId: 'lido-dao',   category: 'defi' },
  { name: 'Maker',      symbol: 'MKR',   slug: 'maker',      coingeckoId: 'maker',      category: 'defi' },
  { name: 'Curve DAO',  symbol: 'CRV',   slug: 'curve',      coingeckoId: 'curve-dao-token', category: 'defi' },
  { name: 'Pendle',     symbol: 'PENDLE',slug: 'pendle',     coingeckoId: 'pendle',     category: 'defi' },
  { name: 'Ethena',     symbol: 'ENA',   slug: 'ethena',     coingeckoId: 'ethena',     category: 'defi' },
  { name: 'Morpho',     symbol: 'MORPHO',slug: 'morpho',     coingeckoId: 'morpho',     category: 'defi' },
  { name: 'Compound',   symbol: 'COMP',  slug: 'compound',   coingeckoId: 'compound-governance-token', category: 'defi' },
  { name: 'Synthetix',  symbol: 'SNX',   slug: 'synthetix',  coingeckoId: 'havven',     category: 'defi' },
  { name: 'SushiSwap',  symbol: 'SUSHI', slug: 'sushi',      coingeckoId: 'sushi',      category: 'defi' },
  { name: '1inch',      symbol: '1INCH', slug: '1inch',      coingeckoId: '1inch',      category: 'defi' },
  { name: 'Balancer',   symbol: 'BAL',   slug: 'balancer',   coingeckoId: 'balancer',   category: 'defi' },
  { name: 'EigenLayer', symbol: 'EIGEN', slug: 'eigenlayer',  coingeckoId: 'eigenlayer', category: 'defi' },
  { name: 'Ondo Finance',symbol:'ONDO',  slug: 'ondo',       coingeckoId: 'ondo-finance', category: 'defi' },

  // Perps / Derivatives
  { name: 'dYdX',       symbol: 'DYDX',  slug: 'dydx',       coingeckoId: 'dydx-chain', category: 'perps' },
  { name: 'GMX',        symbol: 'GMX',   slug: 'gmx',        coingeckoId: 'gmx',        category: 'perps' },
  { name: 'Hyperliquid',symbol: 'HYPE',  slug: 'hyperliquid',coingeckoId: 'hyperliquid', category: 'perps' },
  { name: 'Jupiter',    symbol: 'JUP',   slug: 'jupiter',    coingeckoId: 'jupiter-exchange-solana', category: 'perps' },
  { name: 'Vertex',     symbol: 'VRTX',  slug: 'vertex',     coingeckoId: 'vertex-protocol', category: 'perps' },
  { name: 'Drift',      symbol: 'DRIFT', slug: 'drift',      coingeckoId: 'drift-protocol', category: 'perps' },
  { name: 'Aevo',       symbol: 'AEVO',  slug: 'aevo',       coingeckoId: 'aevo-exchange', category: 'perps' },

  // Solana Ecosystem
  { name: 'Raydium',    symbol: 'RAY',   slug: 'raydium',    coingeckoId: 'raydium',    category: 'solana' },
  { name: 'Jito',       symbol: 'JTO',   slug: 'jito',       coingeckoId: 'jito-governance-token', category: 'solana' },
  { name: 'Marinade',   symbol: 'MNDE',  slug: 'marinade',   coingeckoId: 'marinade',   category: 'solana' },
  { name: 'Pyth Network',symbol:'PYTH',  slug: 'pyth',       coingeckoId: 'pyth-network', category: 'solana' },
  { name: 'Bonk',       symbol: 'BONK',  slug: 'bonk',       coingeckoId: 'bonk',       category: 'solana' },
  { name: 'Render',     symbol: 'RNDR',  slug: 'render',     coingeckoId: 'render-token', category: 'solana' },

  // AI / Infra
  { name: 'Fetch.ai',   symbol: 'FET',   slug: 'fetch-ai',   coingeckoId: 'fetch-ai',   category: 'ai' },
  { name: 'Bittensor',  symbol: 'TAO',   slug: 'bittensor',  coingeckoId: 'bittensor',  category: 'ai' },
  { name: 'Akash Network',symbol:'AKT',  slug: 'akash',      coingeckoId: 'akash-network', category: 'ai' },
  { name: 'Worldcoin',  symbol: 'WLD',   slug: 'worldcoin',  coingeckoId: 'worldcoin-wld', category: 'ai' },

  // Gaming / Metaverse
  { name: 'Immutable',  symbol: 'IMX',   slug: 'immutable',  coingeckoId: 'immutable-x', category: 'gaming' },
  { name: 'The Sandbox',symbol: 'SAND',  slug: 'sandbox',    coingeckoId: 'the-sandbox', category: 'gaming' },
  { name: 'Axie Infinity',symbol:'AXS',  slug: 'axie',       coingeckoId: 'axie-infinity', category: 'gaming' },
  { name: 'Gala',       symbol: 'GALA',  slug: 'gala',       coingeckoId: 'gala',       category: 'gaming' },

  // Memecoins (high search volume)
  { name: 'Pepe',       symbol: 'PEPE',  slug: 'pepe',       coingeckoId: 'pepe',       category: 'meme' },
  { name: 'Shiba Inu',  symbol: 'SHIB',  slug: 'shiba-inu',  coingeckoId: 'shiba-inu',  category: 'meme' },
  { name: 'Floki',      symbol: 'FLOKI', slug: 'floki',      coingeckoId: 'floki',      category: 'meme' },
  { name: 'dogwifhat',  symbol: 'WIF',   slug: 'dogwifhat',  coingeckoId: 'dogwifcoin', category: 'meme' },

  // Privacy / Storage / Other
  { name: 'Monero',     symbol: 'XMR',   slug: 'monero',     coingeckoId: 'monero',     category: 'other' },
  { name: 'Filecoin',   symbol: 'FIL',   slug: 'filecoin',   coingeckoId: 'filecoin',   category: 'other' },
  { name: 'Arweave',    symbol: 'AR',    slug: 'arweave',    coingeckoId: 'arweave',    category: 'other' },
  { name: 'Celestia',   symbol: 'TIA',   slug: 'celestia',   coingeckoId: 'celestia',   category: 'other' },
  { name: 'Sei',        symbol: 'SEI',   slug: 'sei',        coingeckoId: 'sei-network', category: 'other' },
  { name: 'Sui',        symbol: 'SUI',   slug: 'sui',        coingeckoId: 'sui',        category: 'other' },
  { name: 'Aptos',      symbol: 'APT',   slug: 'aptos',      coingeckoId: 'aptos',      category: 'other' },
  { name: 'Near Protocol',symbol:'NEAR', slug: 'near',       coingeckoId: 'near',       category: 'other' },
  { name: 'Cosmos',     symbol: 'ATOM',  slug: 'cosmos',     coingeckoId: 'cosmos',     category: 'other' },
  { name: 'Injective',  symbol: 'INJ',   slug: 'injective',  coingeckoId: 'injective-protocol', category: 'other' },
  { name: 'Hedera',     symbol: 'HBAR',  slug: 'hedera',     coingeckoId: 'hedera-hashgraph', category: 'other' },
  { name: 'VeChain',    symbol: 'VET',   slug: 'vechain',    coingeckoId: 'vechain',    category: 'other' },
  { name: 'Litecoin',   symbol: 'LTC',   slug: 'litecoin',   coingeckoId: 'litecoin',   category: 'other' },
  { name: 'Kaspa',      symbol: 'KAS',   slug: 'kaspa',      coingeckoId: 'kaspa',      category: 'other' },
];

// ─── Protocols (for yield-strategy pages) ───────────────────────────────────
// Each entry generates 1 page: yield-strategy

const protocols = [
  // Lending
  { name: 'Aave',           slug: 'aave',           defillamaId: 'aave',           category: 'lending',  chains: ['Ethereum','Polygon','Arbitrum','Optimism','Avalanche','Base'] },
  { name: 'Compound',       slug: 'compound',       defillamaId: 'compound',       category: 'lending',  chains: ['Ethereum','Polygon','Arbitrum','Base'] },
  { name: 'Morpho',         slug: 'morpho',         defillamaId: 'morpho',         category: 'lending',  chains: ['Ethereum','Base'] },
  { name: 'Spark',          slug: 'spark',          defillamaId: 'spark',          category: 'lending',  chains: ['Ethereum'] },
  { name: 'Radiant Capital',slug: 'radiant',        defillamaId: 'radiant-v2',     category: 'lending',  chains: ['Arbitrum','BNB Chain','Ethereum'] },
  { name: 'Benqi',          slug: 'benqi',          defillamaId: 'benqi',          category: 'lending',  chains: ['Avalanche'] },
  { name: 'Venus',          slug: 'venus',          defillamaId: 'venus',          category: 'lending',  chains: ['BNB Chain'] },
  { name: 'Kamino',         slug: 'kamino',         defillamaId: 'kamino-lend',    category: 'lending',  chains: ['Solana'] },
  { name: 'MarginFi',       slug: 'marginfi',       defillamaId: 'marginfi',       category: 'lending',  chains: ['Solana'] },

  // DEX / AMM
  { name: 'Uniswap',        slug: 'uniswap',        defillamaId: 'uniswap',        category: 'dex',      chains: ['Ethereum','Polygon','Arbitrum','Optimism','Base','BNB Chain'] },
  { name: 'Curve Finance',  slug: 'curve',          defillamaId: 'curve-dex',      category: 'dex',      chains: ['Ethereum','Polygon','Arbitrum','Optimism','Avalanche'] },
  { name: 'Balancer',       slug: 'balancer',       defillamaId: 'balancer',       category: 'dex',      chains: ['Ethereum','Polygon','Arbitrum','Optimism','Avalanche'] },
  { name: 'PancakeSwap',    slug: 'pancakeswap',    defillamaId: 'pancakeswap',    category: 'dex',      chains: ['BNB Chain','Ethereum','Arbitrum'] },
  { name: 'Aerodrome',      slug: 'aerodrome',      defillamaId: 'aerodrome',      category: 'dex',      chains: ['Base'] },
  { name: 'Velodrome',      slug: 'velodrome',      defillamaId: 'velodrome',      category: 'dex',      chains: ['Optimism'] },
  { name: 'Raydium',        slug: 'raydium',        defillamaId: 'raydium',        category: 'dex',      chains: ['Solana'] },
  { name: 'Orca',           slug: 'orca',           defillamaId: 'orca',           category: 'dex',      chains: ['Solana'] },
  { name: 'Trader Joe',     slug: 'trader-joe',     defillamaId: 'trader-joe',     category: 'dex',      chains: ['Avalanche','Arbitrum','BNB Chain'] },
  { name: 'Camelot',        slug: 'camelot',        defillamaId: 'camelot',        category: 'dex',      chains: ['Arbitrum'] },
  { name: 'Maverick',       slug: 'maverick',       defillamaId: 'maverick-protocol', category: 'dex',   chains: ['Ethereum','zkSync Era','Base'] },

  // Liquid Staking
  { name: 'Lido',           slug: 'lido',           defillamaId: 'lido',           category: 'staking',  chains: ['Ethereum'] },
  { name: 'Rocket Pool',    slug: 'rocket-pool',    defillamaId: 'rocket-pool',    category: 'staking',  chains: ['Ethereum'] },
  { name: 'EigenLayer',     slug: 'eigenlayer',     defillamaId: 'eigenlayer',     category: 'staking',  chains: ['Ethereum'] },
  { name: 'Jito',           slug: 'jito',           defillamaId: 'jito',           category: 'staking',  chains: ['Solana'] },
  { name: 'Marinade',       slug: 'marinade',       defillamaId: 'marinade-finance', category: 'staking', chains: ['Solana'] },
  { name: 'Mantle Staked ETH', slug: 'mantle-staked-eth', defillamaId: 'mantle-staked-eth', category: 'staking', chains: ['Ethereum','Mantle'] },
  { name: 'Frax Ether',     slug: 'frax-ether',     defillamaId: 'frax-ether',     category: 'staking',  chains: ['Ethereum'] },
  { name: 'Swell',          slug: 'swell',          defillamaId: 'swell',          category: 'staking',  chains: ['Ethereum'] },
  { name: 'Ether.fi',       slug: 'etherfi',        defillamaId: 'ether.fi',       category: 'staking',  chains: ['Ethereum'] },

  // Yield Optimisers
  { name: 'Yearn Finance',  slug: 'yearn',          defillamaId: 'yearn-finance',  category: 'yield',    chains: ['Ethereum','Polygon','Arbitrum'] },
  { name: 'Convex Finance', slug: 'convex',         defillamaId: 'convex-finance', category: 'yield',    chains: ['Ethereum'] },
  { name: 'Beefy Finance',  slug: 'beefy',          defillamaId: 'beefy',         category: 'yield',    chains: ['Ethereum','Polygon','Arbitrum','Optimism','Avalanche','BNB Chain','Base'] },
  { name: 'Sommelier',      slug: 'sommelier',      defillamaId: 'sommelier',      category: 'yield',    chains: ['Ethereum'] },
  { name: 'Pendle',         slug: 'pendle',         defillamaId: 'pendle',         category: 'yield',    chains: ['Ethereum','Arbitrum','BNB Chain','Optimism'] },

  // Stablecoin Issuers
  { name: 'MakerDAO',       slug: 'makerdao',       defillamaId: 'makerdao',       category: 'stablecoin', chains: ['Ethereum'] },
  { name: 'Ethena',         slug: 'ethena',         defillamaId: 'ethena',         category: 'stablecoin', chains: ['Ethereum'] },
  { name: 'Liquity',        slug: 'liquity',        defillamaId: 'liquity',        category: 'stablecoin', chains: ['Ethereum'] },
  { name: 'Ondo Finance',   slug: 'ondo',           defillamaId: 'ondo-finance',   category: 'stablecoin', chains: ['Ethereum'] },
  { name: 'Mountain Protocol',slug:'mountain',      defillamaId: 'mountain-protocol', category: 'stablecoin', chains: ['Ethereum'] },
  { name: 'Prisma Finance', slug: 'prisma',         defillamaId: 'prisma-finance', category: 'stablecoin', chains: ['Ethereum'] },

  // Perpetuals / Derivatives
  { name: 'GMX',            slug: 'gmx',            defillamaId: 'gmx',            category: 'perps',    chains: ['Arbitrum','Avalanche'] },
  { name: 'dYdX',           slug: 'dydx',           defillamaId: 'dydx',           category: 'perps',    chains: ['dYdX Chain'] },
  { name: 'Hyperliquid',    slug: 'hyperliquid',    defillamaId: 'hyperliquid',    category: 'perps',    chains: ['Hyperliquid L1'] },
  { name: 'Vertex Protocol',slug: 'vertex',         defillamaId: 'vertex-protocol', category: 'perps',   chains: ['Arbitrum'] },
  { name: 'Drift Protocol', slug: 'drift',          defillamaId: 'drift-protocol', category: 'perps',    chains: ['Solana'] },
  { name: 'Jupiter Perps',  slug: 'jupiter-perps',  defillamaId: 'jupiter-perps',  category: 'perps',    chains: ['Solana'] },

  // Bridges / Cross-chain
  { name: 'Stargate',       slug: 'stargate',       defillamaId: 'stargate',       category: 'bridge',   chains: ['Ethereum','Arbitrum','Optimism','Polygon','BNB Chain','Avalanche','Base'] },
  { name: 'Across Protocol',slug: 'across',         defillamaId: 'across',         category: 'bridge',   chains: ['Ethereum','Arbitrum','Optimism','Polygon','Base'] },
  { name: 'Synapse',        slug: 'synapse',        defillamaId: 'synapse',        category: 'bridge',   chains: ['Ethereum','Arbitrum','Optimism','Polygon','BNB Chain','Avalanche'] },
];

// ─── Stablecoins (for comparison page) ──────────────────────────────────────

const stablecoins = [
  { name: 'USDC',   issuer: 'Circle',        type: 'Fiat-backed',    backing: 'Cash + T-Bills',          mcapBillions: 55 },
  { name: 'USDT',   issuer: 'Tether',        type: 'Fiat-backed',    backing: 'Cash + T-Bills + CP',     mcapBillions: 110 },
  { name: 'DAI',    issuer: 'MakerDAO',      type: 'CDP',            backing: 'Multi-collateral + RWA',  mcapBillions: 5.3 },
  { name: 'USDe',   issuer: 'Ethena',        type: 'Synthetic',      backing: 'Delta-neutral hedge',     mcapBillions: 3.5 },
  { name: 'crvUSD', issuer: 'Curve',         type: 'CDP',            backing: 'LLAMMA soft-liquidation', mcapBillions: 0.8 },
  { name: 'GHO',    issuer: 'Aave',          type: 'CDP',            backing: 'Aave collateral',         mcapBillions: 0.2 },
  { name: 'FRAX',   issuer: 'Frax Finance',  type: 'Hybrid',         backing: 'Algorithmic + Collateral',mcapBillions: 0.7 },
  { name: 'LUSD',   issuer: 'Liquity',       type: 'CDP',            backing: 'ETH only',                mcapBillions: 0.3 },
  { name: 'sDAI',   issuer: 'MakerDAO',      type: 'Yield-bearing',  backing: 'DAI Savings Rate',        mcapBillions: 1.2 },
  { name: 'USDM',   issuer: 'Mountain',      type: 'RWA-backed',     backing: 'US Treasuries',           mcapBillions: 0.15 },
  { name: 'USDY',   issuer: 'Ondo Finance',  type: 'RWA-backed',     backing: 'US Treasuries',           mcapBillions: 0.4 },
  { name: 'PYUSD',  issuer: 'PayPal',        type: 'Fiat-backed',    backing: 'Cash + T-Bills',          mcapBillions: 0.5 },
];

// ─── URL Patterns ───────────────────────────────────────────────────────────

const urlPatterns = {
  fundingRate:         '/funding-rate/{{slug}}',       // → /funding-rate/bitcoin
  perpRisk:            '/perp-risk/{{slug}}',          // → /perp-risk/ethereum
  yieldStrategy:       '/yield-strategy/{{slug}}',     // → /yield-strategy/aave
  stablecoinComparison:'/stablecoin-yield-comparison', // → single page
};

// ─── Output directories ─────────────────────────────────────────────────────

const output = {
  pagesDir:    'pages',                   // generated HTML output
  sitemapPath: 'sitemap.xml',             // root sitemap
  domain:      'https://nexxore.xyz',
};

// ─── Data Refresh Config ────────────────────────────────────────────────────

const dataRefresh = {
  fundingRateIntervalMs:  4 * 60 * 60 * 1000,  // 4 hours
  defiMetricsIntervalMs: 12 * 60 * 60 * 1000,  // 12 hours
  priceDataIntervalMs:    1 * 60 * 60 * 1000,   // 1 hour
  cacheDirName:          '.seo-cache',
};

// ─── Exchanges tracked for funding rates ────────────────────────────────────

const exchanges = [
  { name: 'Binance',      slug: 'binance',      type: 'cefi' },
  { name: 'Bybit',        slug: 'bybit',        type: 'cefi' },
  { name: 'OKX',          slug: 'okx',           type: 'cefi' },
  { name: 'Bitget',       slug: 'bitget',        type: 'cefi' },
  { name: 'dYdX',         slug: 'dydx',          type: 'defi' },
  { name: 'GMX',          slug: 'gmx',           type: 'defi' },
  { name: 'Hyperliquid',  slug: 'hyperliquid',   type: 'defi' },
  { name: 'Vertex',       slug: 'vertex',        type: 'defi' },
  { name: 'Drift',        slug: 'drift',         type: 'defi' },
  { name: 'Jupiter Perps',slug: 'jupiter-perps', type: 'defi' },
];

// ─── Estimated page counts ──────────────────────────────────────────────────

function getPageCounts() {
  return {
    fundingRate:          tokens.length,             // 80
    perpRisk:             tokens.length,             // 80
    yieldStrategy:        protocols.length,          // 50
    stablecoinComparison: 1,                         // 1
    total:                tokens.length * 2 + protocols.length + 1,
  };
}

module.exports = {
  tokens,
  protocols,
  stablecoins,
  exchanges,
  urlPatterns,
  output,
  dataRefresh,
  getPageCounts,
};
