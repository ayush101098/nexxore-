/**
 * Alpha Scanner API - Real-time DeFi Data Pipeline
 * Fetches live data from DeFiLlama, CoinGecko, and yield aggregators
 */

// Data Sources Configuration
const DATA_SOURCES = {
    DEFILLAMA: {
        base: 'https://api.llama.fi',
        protocols: '/protocols',
        tvl: '/tvl',
        yields: 'https://yields.llama.fi/pools',
        charts: '/charts'
    },
    COINGECKO: {
        base: 'https://api.coingecko.com/api/v3',
        prices: '/simple/price',
        coins: '/coins/markets'
    },
    DEXSCREENER: {
        base: 'https://api.dexscreener.com/latest',
        tokens: '/dex/tokens'
    }
};

// Protocol mappings for accurate data fetching
const PROTOCOL_IDS = {
    'aave': { llama: 'aave', coingecko: 'aave', category: 'lending' },
    'uniswap': { llama: 'uniswap', coingecko: 'uniswap', category: 'dex' },
    'lido': { llama: 'lido', coingecko: 'lido-dao', category: 'liquid-staking' },
    'curve-dex': { llama: 'curve-dex', coingecko: 'curve-dao-token', category: 'dex' },
    'compound': { llama: 'compound-finance', coingecko: 'compound-governance-token', category: 'lending' },
    'gmx': { llama: 'gmx', coingecko: 'gmx', category: 'perps' },
    'pendle': { llama: 'pendle', coingecko: 'pendle', category: 'yield' },
    'eigenlayer': { llama: 'eigenlayer', coingecko: 'eigenlayer', category: 'restaking' },
    'morpho': { llama: 'morpho', coingecko: 'morpho', category: 'lending' },
    'ethena': { llama: 'ethena', coingecko: 'ethena', category: 'stablecoin' },
    'maker': { llama: 'makerdao', coingecko: 'maker', category: 'cdp' },
    'rocket-pool': { llama: 'rocket-pool', coingecko: 'rocket-pool', category: 'liquid-staking' },
    'jupiter': { llama: 'jupiter', coingecko: 'jupiter-exchange-solana', category: 'dex' },
    'raydium': { llama: 'raydium', coingecko: 'raydium', category: 'dex' },
    'dydx': { llama: 'dydx', coingecko: 'dydx-chain', category: 'perps' },
    'convex-finance': { llama: 'convex-finance', coingecko: 'convex-finance', category: 'yield' },
    'yearn-finance': { llama: 'yearn-finance', coingecko: 'yearn-finance', category: 'yield' },
    'pancakeswap': { llama: 'pancakeswap', coingecko: 'pancakeswap-token', category: 'dex' },
    'sushiswap': { llama: 'sushiswap', coingecko: 'sushi', category: 'dex' },
    'balancer-v2': { llama: 'balancer-v2', coingecko: 'balancer', category: 'dex' },
    'instadapp': { llama: 'instadapp', coingecko: 'instadapp', category: 'aggregator' },
    'spark': { llama: 'spark', coingecko: 'spark', category: 'lending' },
    'frax-ether': { llama: 'frax-ether', coingecko: 'frax-ether', category: 'liquid-staking' },
    'benqi-lending': { llama: 'benqi-lending', coingecko: 'benqi', category: 'lending' },
    'venus': { llama: 'venus', coingecko: 'venus', category: 'lending' }
};

// Cache for API responses
let cache = {
    protocols: null,
    yields: null,
    prices: null,
    lastUpdate: null
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all protocols from DeFiLlama
 */
async function fetchProtocols() {
    try {
        const response = await fetch(`${DATA_SOURCES.DEFILLAMA.base}/protocols`);
        if (!response.ok) throw new Error(`DeFiLlama API error: ${response.status}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch protocols:', error);
        return null;
    }
}

/**
 * Fetch yield pools from DeFiLlama
 */
async function fetchYields() {
    try {
        const response = await fetch(DATA_SOURCES.DEFILLAMA.yields);
        if (!response.ok) throw new Error(`Yields API error: ${response.status}`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error('Failed to fetch yields:', error);
        return [];
    }
}

/**
 * Fetch prices from CoinGecko
 */
async function fetchPrices(coinIds) {
    try {
        const ids = coinIds.join(',');
        const response = await fetch(
            `${DATA_SOURCES.COINGECKO.base}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true`
        );
        if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch prices:', error);
        return {};
    }
}

/**
 * Fetch detailed market data from CoinGecko
 */
async function fetchMarketData(coinIds) {
    try {
        const ids = coinIds.join(',');
        const response = await fetch(
            `${DATA_SOURCES.COINGECKO.base}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d`
        );
        if (!response.ok) throw new Error(`CoinGecko markets API error: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch market data:', error);
        return [];
    }
}

/**
 * Main data aggregation function
 */
async function aggregateData() {
    const now = Date.now();
    
    // Return cached data if fresh
    if (cache.lastUpdate && (now - cache.lastUpdate) < CACHE_TTL) {
        return {
            protocols: cache.protocols,
            yields: cache.yields,
            prices: cache.prices,
            cached: true,
            lastUpdate: cache.lastUpdate
        };
    }

    console.log('Fetching fresh data from APIs...');
    
    // Fetch all data in parallel
    const [protocols, yields] = await Promise.all([
        fetchProtocols(),
        fetchYields()
    ]);

    // Get CoinGecko IDs for price fetching
    const coingeckoIds = Object.values(PROTOCOL_IDS).map(p => p.coingecko);
    const prices = await fetchPrices(coingeckoIds);
    const marketData = await fetchMarketData(coingeckoIds);

    // Update cache
    cache = {
        protocols,
        yields,
        prices,
        marketData,
        lastUpdate: now
    };

    return {
        protocols,
        yields,
        prices,
        marketData,
        cached: false,
        lastUpdate: now
    };
}

/**
 * Calculate alpha score for a protocol
 */
function calculateAlphaScore(protocol, yields, prices, marketData) {
    let score = 50; // Base score
    const factors = [];

    // 1. TVL Analysis (0-25 points)
    const tvl = protocol.tvl || 0;
    const tvlChange24h = protocol.change_1d || 0;
    const tvlChange7d = protocol.change_7d || 0;
    
    if (tvl > 10e9) score += 15;
    else if (tvl > 1e9) score += 10;
    else if (tvl > 100e6) score += 5;
    
    if (tvlChange24h > 5) { score += 10; factors.push(`TVL surging +${tvlChange24h.toFixed(1)}% 24h`); }
    else if (tvlChange24h > 2) { score += 5; factors.push(`TVL growing +${tvlChange24h.toFixed(1)}% 24h`); }
    else if (tvlChange24h < -5) { score -= 10; factors.push(`TVL declining ${tvlChange24h.toFixed(1)}% 24h`); }

    // 2. Yield Analysis (0-25 points)
    const protocolYields = yields.filter(y => 
        y.project?.toLowerCase() === protocol.slug?.toLowerCase() ||
        y.project?.toLowerCase().includes(protocol.name?.toLowerCase())
    );
    
    const avgApy = protocolYields.length > 0 
        ? protocolYields.reduce((sum, y) => sum + (y.apy || 0), 0) / protocolYields.length 
        : 0;
    
    const maxApy = protocolYields.length > 0 
        ? Math.max(...protocolYields.map(y => y.apy || 0))
        : 0;

    if (maxApy > 20) { score += 15; factors.push(`High yield opportunity: ${maxApy.toFixed(1)}% APY`); }
    else if (maxApy > 10) { score += 10; factors.push(`Attractive yield: ${maxApy.toFixed(1)}% APY`); }
    else if (maxApy > 5) { score += 5; factors.push(`Moderate yield: ${maxApy.toFixed(1)}% APY`); }

    // 3. Price Momentum (0-20 points)
    const priceInfo = Object.entries(prices).find(([id]) => 
        id.toLowerCase().includes(protocol.name?.toLowerCase().split(' ')[0])
    );
    
    const tokenMarket = marketData?.find(m => 
        m.id?.toLowerCase().includes(protocol.name?.toLowerCase().split(' ')[0])
    );

    if (tokenMarket) {
        const change24h = tokenMarket.price_change_percentage_24h || 0;
        const change7d = tokenMarket.price_change_percentage_7d_in_currency || 0;
        
        if (change24h > 10) { score += 15; factors.push(`Strong momentum +${change24h.toFixed(1)}% 24h`); }
        else if (change24h > 5) { score += 10; factors.push(`Bullish trend +${change24h.toFixed(1)}% 24h`); }
        else if (change24h > 0) { score += 5; factors.push(`Positive price action +${change24h.toFixed(1)}% 24h`); }
        else if (change24h < -10) { score -= 10; factors.push(`Bearish pressure ${change24h.toFixed(1)}% 24h`); }
        
        // Reversal detection
        if (change24h > 5 && change7d < -10) {
            score += 10;
            factors.push(`Potential reversal: recovering from -${Math.abs(change7d).toFixed(1)}% weekly`);
        }
    }

    // 4. Category Bonus (0-10 points)
    const category = protocol.category?.toLowerCase();
    if (category === 'liquid staking' || category === 'restaking') {
        score += 10;
        factors.push('Hot sector: Liquid staking/Restaking narrative');
    } else if (category === 'yield' || category === 'yield aggregator') {
        score += 8;
        factors.push('Yield optimization strategy');
    } else if (category === 'derivatives' || category === 'perps') {
        score += 5;
        factors.push('Derivatives volume trending');
    }

    // 5. Risk Assessment (-20 to +10 points)
    const mcapTvl = protocol.mcap && tvl ? protocol.mcap / tvl : null;
    if (mcapTvl && mcapTvl < 0.5) {
        score += 10;
        factors.push(`Undervalued: MCap/TVL ratio ${mcapTvl.toFixed(2)}`);
    } else if (mcapTvl && mcapTvl > 5) {
        score -= 10;
        factors.push(`Overvalued risk: MCap/TVL ratio ${mcapTvl.toFixed(2)}`);
    }

    // Audit status
    if (protocol.audits && protocol.audits > 0) {
        score += 5;
    }

    // Normalize score
    score = Math.max(0, Math.min(100, score));

    return {
        score,
        factors,
        metrics: {
            tvl,
            tvlChange24h,
            tvlChange7d,
            avgApy,
            maxApy,
            price: tokenMarket?.current_price,
            priceChange24h: tokenMarket?.price_change_percentage_24h,
            priceChange7d: tokenMarket?.price_change_percentage_7d_in_currency,
            marketCap: tokenMarket?.market_cap,
            mcapTvl
        }
    };
}

/**
 * Generate trading signal from alpha analysis
 */
function generateSignal(protocol, alphaAnalysis, prices, marketData) {
    const tokenMarket = marketData?.find(m => 
        m.id?.toLowerCase().includes(protocol.name?.toLowerCase().split(' ')[0])
    );

    const currentPrice = tokenMarket?.current_price || 0;
    const volatility = Math.abs(tokenMarket?.price_change_percentage_24h || 5) / 100;
    
    // Calculate targets based on alpha score and volatility
    const targetMultiplier = 1 + (alphaAnalysis.score / 500) + volatility;
    const stopMultiplier = 1 - (0.03 + volatility * 0.5);

    const signal = {
        id: `sig_${protocol.slug}_${Date.now()}`,
        protocol: protocol.name,
        slug: protocol.slug,
        chain: protocol.chain || 'multi-chain',
        chains: protocol.chains || [protocol.chain],
        category: protocol.category,
        token: protocol.symbol || protocol.name.toUpperCase().slice(0, 4),
        
        // Signal details
        action: alphaAnalysis.score >= 60 ? 'BUY' : 'WATCH',
        alphaScore: alphaAnalysis.score,
        confidence: Math.round(40 + alphaAnalysis.score * 0.5),
        riskLevel: alphaAnalysis.score >= 75 ? 'LOW' : alphaAnalysis.score >= 55 ? 'MEDIUM' : 'HIGH',
        
        // Pricing
        entryPrice: currentPrice,
        targetPrice: currentPrice * targetMultiplier,
        stopLoss: currentPrice * stopMultiplier,
        expectedReturn: ((targetMultiplier - 1) * 100).toFixed(1),
        
        // Metrics
        tvl: alphaAnalysis.metrics.tvl,
        tvlChange24h: alphaAnalysis.metrics.tvlChange24h,
        apy: alphaAnalysis.metrics.maxApy,
        marketCap: alphaAnalysis.metrics.marketCap,
        priceChange24h: alphaAnalysis.metrics.priceChange24h,
        
        // Analysis
        reasoning: alphaAnalysis.factors.slice(0, 4).join('. ') + '.',
        factors: alphaAnalysis.factors,
        
        // Metadata
        status: 'ACTIVE',
        source: 'ALPHA_SCANNER',
        dataFreshness: 'LIVE',
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    return signal;
}

/**
 * Main scanner function - generates alpha signals
 */
async function scanForAlpha() {
    const startTime = Date.now();
    
    // Aggregate all data
    const data = await aggregateData();
    
    if (!data.protocols) {
        return {
            success: false,
            error: 'Failed to fetch protocol data',
            signals: []
        };
    }

    // Filter to top protocols by TVL
    const topProtocols = data.protocols
        .filter(p => p.tvl > 50e6) // Min $50M TVL
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, 100);

    // Generate signals for each protocol
    const signals = [];
    
    for (const protocol of topProtocols) {
        const alphaAnalysis = calculateAlphaScore(
            protocol, 
            data.yields, 
            data.prices, 
            data.marketData
        );
        
        // Only generate signals for score >= 50
        if (alphaAnalysis.score >= 50) {
            const signal = generateSignal(protocol, alphaAnalysis, data.prices, data.marketData);
            signals.push(signal);
        }
    }

    // Sort by alpha score
    signals.sort((a, b) => b.alphaScore - a.alphaScore);

    return {
        success: true,
        signals: signals.slice(0, 30), // Top 30 signals
        metadata: {
            scannedProtocols: topProtocols.length,
            signalsGenerated: signals.length,
            scanDuration: Date.now() - startTime,
            dataFreshness: data.cached ? 'CACHED' : 'LIVE',
            lastUpdate: new Date(data.lastUpdate).toISOString()
        }
    };
}

/**
 * Get yield opportunities
 */
async function getYieldOpportunities() {
    const data = await aggregateData();
    
    if (!data.yields) {
        return { success: false, error: 'Failed to fetch yield data', opportunities: [] };
    }

    // Filter and sort yield pools
    const topYields = data.yields
        .filter(y => y.tvlUsd > 1e6 && y.apy > 5 && y.apy < 500) // Filter outliers
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 50)
        .map(y => ({
            pool: y.pool,
            project: y.project,
            chain: y.chain,
            symbol: y.symbol,
            tvl: y.tvlUsd,
            apy: y.apy,
            apyBase: y.apyBase,
            apyReward: y.apyReward,
            stablecoin: y.stablecoin,
            ilRisk: y.ilRisk,
            exposure: y.exposure
        }));

    return {
        success: true,
        opportunities: topYields,
        metadata: {
            totalPools: data.yields.length,
            filteredPools: topYields.length,
            dataFreshness: data.cached ? 'CACHED' : 'LIVE'
        }
    };
}

// Vercel serverless handler
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        switch (action) {
            case 'scan':
                const scanResult = await scanForAlpha();
                return res.status(200).json(scanResult);

            case 'yields':
                const yieldsResult = await getYieldOpportunities();
                return res.status(200).json(yieldsResult);

            case 'health':
                return res.status(200).json({
                    status: 'healthy',
                    cache: {
                        hasData: !!cache.protocols,
                        lastUpdate: cache.lastUpdate ? new Date(cache.lastUpdate).toISOString() : null,
                        age: cache.lastUpdate ? Date.now() - cache.lastUpdate : null
                    }
                });

            default:
                // Default: run full scan
                const defaultResult = await scanForAlpha();
                return res.status(200).json(defaultResult);
        }
    } catch (error) {
        console.error('Alpha scanner error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

// Export for local testing
module.exports = { scanForAlpha, getYieldOpportunities, aggregateData };
