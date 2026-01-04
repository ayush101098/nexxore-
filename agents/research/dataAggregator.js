/**
 * Multi-Source Data Aggregator
 * Fetches and aggregates data from multiple DeFi data providers
 * for world-class signal generation
 */

const DATA_SOURCES = {
    // DeFiLlama - Comprehensive DeFi data
    DEFILLAMA: {
        protocols: 'https://api.llama.fi/protocols',
        tvlHistory: 'https://api.llama.fi/v2/historicalChainTvl',
        yields: 'https://yields.llama.fi/pools',
        yieldHistory: 'https://yields.llama.fi/chart',
        stablecoins: 'https://stablecoins.llama.fi/stablecoins',
        stablecoinHistory: 'https://stablecoins.llama.fi/stablecoincharts/all',
        bridges: 'https://bridges.llama.fi/bridges',
        bridgeVolume: 'https://bridges.llama.fi/bridgevolume/all',
        dexVolumes: 'https://api.llama.fi/overview/dexs',
        fees: 'https://api.llama.fi/overview/fees',
        revenue: 'https://api.llama.fi/summary/fees',
        options: 'https://api.llama.fi/overview/options',
        derivatives: 'https://api.llama.fi/overview/derivatives'
    },
    
    // CoinGecko - Market & Social data
    COINGECKO: {
        markets: 'https://api.coingecko.com/api/v3/coins/markets',
        coin: 'https://api.coingecko.com/api/v3/coins',
        trending: 'https://api.coingecko.com/api/v3/search/trending',
        global: 'https://api.coingecko.com/api/v3/global/defi'
    },
    
    // Alternative.me - Fear & Greed
    ALTERNATIVE: {
        fearGreed: 'https://api.alternative.me/fng/?limit=30'
    },
    
    // DexScreener - Real-time DEX data
    DEXSCREENER: {
        pairs: 'https://api.dexscreener.com/latest/dex/pairs',
        tokens: 'https://api.dexscreener.com/latest/dex/tokens',
        search: 'https://api.dexscreener.com/latest/dex/search'
    }
};

// Protocol ID mappings for cross-referencing
const PROTOCOL_MAPPINGS = {
    'lido': { coingecko: 'lido-dao', symbol: 'LDO', category: 'liquid-staking' },
    'aave': { coingecko: 'aave', symbol: 'AAVE', category: 'lending' },
    'uniswap': { coingecko: 'uniswap', symbol: 'UNI', category: 'dex' },
    'makerdao': { coingecko: 'maker', symbol: 'MKR', category: 'cdp' },
    'curve-dex': { coingecko: 'curve-dao-token', symbol: 'CRV', category: 'dex' },
    'compound-finance': { coingecko: 'compound-governance-token', symbol: 'COMP', category: 'lending' },
    'eigenlayer': { coingecko: 'eigenlayer', symbol: 'EIGEN', category: 'restaking' },
    'rocket-pool': { coingecko: 'rocket-pool', symbol: 'RPL', category: 'liquid-staking' },
    'gmx': { coingecko: 'gmx', symbol: 'GMX', category: 'perps' },
    'pendle': { coingecko: 'pendle', symbol: 'PENDLE', category: 'yield' },
    'ethena': { coingecko: 'ethena', symbol: 'ENA', category: 'synthetic' },
    'morpho': { coingecko: 'morpho', symbol: 'MORPHO', category: 'lending' },
    'jupiter': { coingecko: 'jupiter-exchange-solana', symbol: 'JUP', category: 'dex' },
    'raydium': { coingecko: 'raydium', symbol: 'RAY', category: 'dex' },
    'dydx': { coingecko: 'dydx-chain', symbol: 'DYDX', category: 'perps' },
    'pancakeswap': { coingecko: 'pancakeswap-token', symbol: 'CAKE', category: 'dex' },
    'sushiswap': { coingecko: 'sushi', symbol: 'SUSHI', category: 'dex' },
    'balancer-v2': { coingecko: 'balancer', symbol: 'BAL', category: 'dex' },
    'convex-finance': { coingecko: 'convex-finance', symbol: 'CVX', category: 'yield' },
    'yearn-finance': { coingecko: 'yearn-finance', symbol: 'YFI', category: 'yield' },
    'frax-ether': { coingecko: 'frax-ether', symbol: 'FRXETH', category: 'liquid-staking' },
    'instadapp': { coingecko: 'instadapp', symbol: 'INST', category: 'aggregator' },
    'benqi-lending': { coingecko: 'benqi', symbol: 'QI', category: 'lending' },
    'venus': { coingecko: 'venus', symbol: 'XVS', category: 'lending' },
    'spark': { coingecko: 'spark', symbol: 'SPK', category: 'lending' },
    'ondo-finance': { coingecko: 'ondo-finance', symbol: 'ONDO', category: 'rwa' },
    'jito': { coingecko: 'jito-governance-token', symbol: 'JTO', category: 'liquid-staking' },
    'marinade': { coingecko: 'marinade', symbol: 'MNDE', category: 'liquid-staking' },
    'aerodrome': { coingecko: 'aerodrome-finance', symbol: 'AERO', category: 'dex' },
    'velodrome': { coingecko: 'velodrome-finance', symbol: 'VELO', category: 'dex' },
    'hyperliquid': { coingecko: 'hyperliquid', symbol: 'HYPE', category: 'perps' },
    'vertex-protocol': { coingecko: 'vertex-protocol', symbol: 'VRTX', category: 'perps' }
};

class DataAggregator {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        this.rateLimits = {
            coingecko: { calls: 0, resetTime: Date.now(), maxCalls: 50 },
            defillama: { calls: 0, resetTime: Date.now(), maxCalls: 300 }
        };
    }

    /**
     * Fetch with caching and rate limiting
     */
    async fetchWithCache(url, source = 'defillama') {
        const cached = this.cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        // Rate limiting
        const limit = this.rateLimits[source];
        if (limit) {
            if (Date.now() - limit.resetTime > 60000) {
                limit.calls = 0;
                limit.resetTime = Date.now();
            }
            if (limit.calls >= limit.maxCalls) {
                console.warn(`Rate limit hit for ${source}, using cached data`);
                return cached?.data || null;
            }
            limit.calls++;
        }

        try {
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                timeout: 10000
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.cache.set(url, { data, timestamp: Date.now() });
            return data;
        } catch (error) {
            console.error(`Failed to fetch ${url}:`, error.message);
            return cached?.data || null;
        }
    }

    /**
     * Fetch all DeFiLlama protocols with TVL data
     */
    async fetchProtocols() {
        const data = await this.fetchWithCache(DATA_SOURCES.DEFILLAMA.protocols);
        if (!data) return [];
        
        return data
            .filter(p => p.tvl > 50_000_000) // Min $50M TVL
            .map(p => ({
                id: p.slug,
                name: p.name,
                symbol: p.symbol,
                tvl: p.tvl,
                tvlChange1d: p.change_1d || 0,
                tvlChange7d: p.change_7d || 0,
                tvlChange1m: p.change_1m || 0,
                chains: p.chains || [],
                category: p.category,
                mcap: p.mcap,
                fdv: p.fdv,
                audits: p.audits,
                listedAt: p.listedAt,
                url: p.url
            }))
            .sort((a, b) => b.tvl - a.tvl);
    }

    /**
     * Fetch yield pools with APY data
     */
    async fetchYields() {
        const data = await this.fetchWithCache(DATA_SOURCES.DEFILLAMA.yields);
        if (!data?.data) return [];
        
        return data.data
            .filter(y => y.tvlUsd > 1_000_000 && y.apy > 0 && y.apy < 1000)
            .map(y => ({
                pool: y.pool,
                project: y.project,
                chain: y.chain,
                symbol: y.symbol,
                tvl: y.tvlUsd,
                apy: y.apy,
                apyBase: y.apyBase || 0,
                apyReward: y.apyReward || 0,
                apyMean30d: y.apyMean30d,
                ilRisk: y.ilRisk,
                stablecoin: y.stablecoin,
                exposure: y.exposure,
                predictedClass: y.predictedClass,
                mu: y.mu,
                sigma: y.sigma
            }));
    }

    /**
     * Fetch DEX volumes
     */
    async fetchDexVolumes() {
        const data = await this.fetchWithCache(DATA_SOURCES.DEFILLAMA.dexVolumes);
        if (!data?.protocols) return [];
        
        return data.protocols.map(d => ({
            name: d.name,
            volume24h: d.total24h || 0,
            volume7d: d.total7d || 0,
            volumeChange: d.change_1d || 0,
            chains: d.chains || []
        }));
    }

    /**
     * Fetch protocol fees & revenue
     */
    async fetchFees() {
        const data = await this.fetchWithCache(DATA_SOURCES.DEFILLAMA.fees);
        if (!data?.protocols) return [];
        
        return data.protocols.map(f => ({
            name: f.name,
            fees24h: f.total24h || 0,
            fees7d: f.total7d || 0,
            feesChange: f.change_1d || 0,
            category: f.category
        }));
    }

    /**
     * Fetch CoinGecko market data for tokens
     */
    async fetchMarketData(coinIds) {
        if (!coinIds || coinIds.length === 0) return [];
        
        const url = `${DATA_SOURCES.COINGECKO.markets}?vs_currency=usd&ids=${coinIds.join(',')}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,14d,30d`;
        const data = await this.fetchWithCache(url, 'coingecko');
        
        if (!data) return [];
        
        return data.map(c => ({
            id: c.id,
            symbol: c.symbol?.toUpperCase(),
            name: c.name,
            price: c.current_price,
            marketCap: c.market_cap,
            marketCapRank: c.market_cap_rank,
            fdv: c.fully_diluted_valuation,
            volume24h: c.total_volume,
            priceChange1h: c.price_change_percentage_1h_in_currency || 0,
            priceChange24h: c.price_change_percentage_24h || 0,
            priceChange7d: c.price_change_percentage_7d_in_currency || 0,
            priceChange14d: c.price_change_percentage_14d_in_currency || 0,
            priceChange30d: c.price_change_percentage_30d_in_currency || 0,
            ath: c.ath,
            athChangePercent: c.ath_change_percentage,
            atl: c.atl,
            atlChangePercent: c.atl_change_percentage,
            circulatingSupply: c.circulating_supply,
            totalSupply: c.total_supply,
            maxSupply: c.max_supply,
            sparkline: c.sparkline_in_7d?.price || []
        }));
    }

    /**
     * Fetch Fear & Greed Index
     */
    async fetchFearGreed() {
        const data = await this.fetchWithCache(DATA_SOURCES.ALTERNATIVE.fearGreed);
        if (!data?.data) return null;
        
        return {
            current: parseInt(data.data[0]?.value) || 50,
            classification: data.data[0]?.value_classification || 'Neutral',
            yesterday: parseInt(data.data[1]?.value) || 50,
            lastWeek: parseInt(data.data[7]?.value) || 50,
            lastMonth: parseInt(data.data[29]?.value) || 50,
            history: data.data.slice(0, 30).map(d => ({
                value: parseInt(d.value),
                date: new Date(d.timestamp * 1000).toISOString()
            }))
        };
    }

    /**
     * Fetch global DeFi metrics
     */
    async fetchGlobalDefi() {
        const data = await this.fetchWithCache(DATA_SOURCES.COINGECKO.global, 'coingecko');
        if (!data?.data) return null;
        
        return {
            defiMarketCap: data.data.defi_market_cap,
            ethMarketCap: data.data.eth_market_cap,
            defiToEthRatio: data.data.defi_to_eth_ratio,
            tradingVolume24h: data.data.trading_volume_24h,
            defiDominance: data.data.defi_dominance,
            topCoinDominance: data.data.top_coin_defi_dominance
        };
    }

    /**
     * Fetch DexScreener data for a token
     */
    async fetchDexScreener(tokenAddress, chain = 'ethereum') {
        const url = `${DATA_SOURCES.DEXSCREENER.tokens}/${chain}/${tokenAddress}`;
        const data = await this.fetchWithCache(url);
        
        if (!data?.pairs) return null;
        
        // Get the most liquid pair
        const topPair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        
        return topPair ? {
            price: parseFloat(topPair.priceUsd) || 0,
            priceChange5m: topPair.priceChange?.m5 || 0,
            priceChange1h: topPair.priceChange?.h1 || 0,
            priceChange6h: topPair.priceChange?.h6 || 0,
            priceChange24h: topPair.priceChange?.h24 || 0,
            volume24h: topPair.volume?.h24 || 0,
            liquidity: topPair.liquidity?.usd || 0,
            txns24h: (topPair.txns?.h24?.buys || 0) + (topPair.txns?.h24?.sells || 0),
            buyers24h: topPair.txns?.h24?.buys || 0,
            sellers24h: topPair.txns?.h24?.sells || 0,
            fdv: topPair.fdv || 0
        } : null;
    }

    /**
     * Aggregate all data for a protocol
     */
    async aggregateProtocolData(protocolSlug) {
        const mapping = PROTOCOL_MAPPINGS[protocolSlug];
        if (!mapping) return null;

        const [protocols, yields, dexVolumes, fees, marketData] = await Promise.all([
            this.fetchProtocols(),
            this.fetchYields(),
            this.fetchDexVolumes(),
            this.fetchFees(),
            this.fetchMarketData([mapping.coingecko])
        ]);

        const protocol = protocols.find(p => p.id === protocolSlug);
        const protocolYields = yields.filter(y => 
            y.project?.toLowerCase() === protocolSlug.toLowerCase()
        );
        const protocolVolume = dexVolumes.find(d => 
            d.name?.toLowerCase().includes(protocolSlug.split('-')[0])
        );
        const protocolFees = fees.find(f => 
            f.name?.toLowerCase().includes(protocolSlug.split('-')[0])
        );
        const market = marketData[0];

        return {
            protocol: {
                id: protocolSlug,
                name: protocol?.name || mapping.symbol,
                symbol: mapping.symbol,
                category: mapping.category,
                ...protocol
            },
            yields: {
                pools: protocolYields.length,
                maxApy: Math.max(...protocolYields.map(y => y.apy), 0),
                avgApy: protocolYields.length > 0 
                    ? protocolYields.reduce((s, y) => s + y.apy, 0) / protocolYields.length 
                    : 0,
                totalTvl: protocolYields.reduce((s, y) => s + y.tvl, 0),
                topPool: protocolYields.sort((a, b) => b.tvl - a.tvl)[0] || null
            },
            volume: protocolVolume || { volume24h: 0, volume7d: 0, volumeChange: 0 },
            fees: protocolFees || { fees24h: 0, fees7d: 0, feesChange: 0 },
            market: market || null,
            mapping
        };
    }

    /**
     * Get comprehensive market overview
     */
    async getMarketOverview() {
        const [protocols, globalDefi, fearGreed, dexVolumes, fees] = await Promise.all([
            this.fetchProtocols(),
            this.fetchGlobalDefi(),
            this.fetchFearGreed(),
            this.fetchDexVolumes(),
            this.fetchFees()
        ]);

        const totalTvl = protocols.reduce((s, p) => s + p.tvl, 0);
        const totalVolume = dexVolumes.reduce((s, d) => s + d.volume24h, 0);
        const totalFees = fees.reduce((s, f) => s + f.fees24h, 0);

        // Aggregate by category
        const byCategory = {};
        protocols.forEach(p => {
            const cat = p.category || 'Other';
            if (!byCategory[cat]) {
                byCategory[cat] = { tvl: 0, count: 0, avgChange: 0 };
            }
            byCategory[cat].tvl += p.tvl;
            byCategory[cat].count++;
            byCategory[cat].avgChange += p.tvlChange1d;
        });
        
        Object.keys(byCategory).forEach(cat => {
            byCategory[cat].avgChange /= byCategory[cat].count;
        });

        return {
            summary: {
                totalTvl,
                totalVolume24h: totalVolume,
                totalFees24h: totalFees,
                protocolCount: protocols.length,
                timestamp: new Date().toISOString()
            },
            sentiment: {
                fearGreed: fearGreed?.current || 50,
                classification: fearGreed?.classification || 'Neutral',
                trend: fearGreed ? fearGreed.current - fearGreed.lastWeek : 0
            },
            global: globalDefi,
            categories: byCategory,
            topProtocols: protocols.slice(0, 20),
            topGainers: protocols.filter(p => p.tvlChange1d > 0)
                .sort((a, b) => b.tvlChange1d - a.tvlChange1d).slice(0, 10),
            topLosers: protocols.filter(p => p.tvlChange1d < 0)
                .sort((a, b) => a.tvlChange1d - b.tvlChange1d).slice(0, 10)
        };
    }
}

// Export singleton instance
const dataAggregator = new DataAggregator();

module.exports = {
    DataAggregator,
    dataAggregator,
    DATA_SOURCES,
    PROTOCOL_MAPPINGS
};
