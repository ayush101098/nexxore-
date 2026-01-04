/**
 * Advanced Alpha Scanner API
 * Powered by ML Feature Engineering & Research Analyst Agent
 */

// Import modules (for Vercel serverless, we inline the necessary code)
const DATA_SOURCES = {
    DEFILLAMA: {
        protocols: 'https://api.llama.fi/protocols',
        yields: 'https://yields.llama.fi/pools',
        dexVolumes: 'https://api.llama.fi/overview/dexs',
        fees: 'https://api.llama.fi/overview/fees'
    },
    COINGECKO: {
        markets: 'https://api.coingecko.com/api/v3/coins/markets'
    },
    ALTERNATIVE: {
        fearGreed: 'https://api.alternative.me/fng/?limit=30'
    }
};

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
    'instadapp': { coingecko: 'instadapp', symbol: 'INST', category: 'aggregator' },
    'benqi-lending': { coingecko: 'benqi', symbol: 'QI', category: 'lending' },
    'venus': { coingecko: 'venus', symbol: 'XVS', category: 'lending' },
    'ondo-finance': { coingecko: 'ondo-finance', symbol: 'ONDO', category: 'rwa' },
    'jito': { coingecko: 'jito-governance-token', symbol: 'JTO', category: 'liquid-staking' },
    'marinade': { coingecko: 'marinade', symbol: 'MNDE', category: 'liquid-staking' },
    'aerodrome': { coingecko: 'aerodrome-finance', symbol: 'AERO', category: 'dex' },
    'velodrome': { coingecko: 'velodrome-finance', symbol: 'VELO', category: 'dex' },
    'hyperliquid': { coingecko: 'hyperliquid', symbol: 'HYPE', category: 'perps' },
    'vertex-protocol': { coingecko: 'vertex-protocol', symbol: 'VRTX', category: 'perps' }
};

// Feature weights for ML scoring
const FEATURE_WEIGHTS = {
    tvlMomentum: 0.12,
    tvlAcceleration: 0.08,
    priceStrength: 0.10,
    volumeMomentum: 0.08,
    yieldAttractiveness: 0.10,
    yieldSustainability: 0.06,
    revenueGrowth: 0.10,
    feeEfficiency: 0.06,
    trendStrength: 0.06,
    sentimentScore: 0.08,
    categoryMomentum: 0.06,
    riskScore: 0.05,
    liquidityScore: 0.05
};

// Category momentum multipliers
const CATEGORY_MOMENTUM = {
    'restaking': 1.25,
    'liquid-staking': 1.15,
    'rwa': 1.20,
    'perps': 1.10,
    'lending': 1.05,
    'yield': 1.08,
    'dex': 1.0,
    'cdp': 0.95,
    'synthetic': 1.05,
    'aggregator': 1.0
};

// Cache for API responses
let cache = {
    protocols: { data: null, timestamp: 0 },
    yields: { data: null, timestamp: 0 },
    market: { data: null, timestamp: 0 },
    fearGreed: { data: null, timestamp: 0 },
    dexVolumes: { data: null, timestamp: 0 },
    fees: { data: null, timestamp: 0 }
};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchWithCache(key, url, transform = null) {
    const now = Date.now();
    if (cache[key].data && (now - cache[key].timestamp) < CACHE_TTL) {
        return cache[key].data;
    }
    
    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        let data = await response.json();
        if (transform) data = transform(data);
        
        cache[key] = { data, timestamp: now };
        return data;
    } catch (error) {
        console.error(`Fetch error for ${key}:`, error.message);
        return cache[key].data || null;
    }
}

// Feature Engineering Functions
function normalize(value, min, max) {
    if (max === min) return 0.5;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function calculateTvlFeatures(protocol, allProtocols) {
    const tvlChange1d = protocol.tvlChange1d || 0;
    const tvlChange7d = protocol.tvlChange7d || 0;
    const tvlChange1m = protocol.tvlChange1m || 0;
    
    const tvlMomentum = normalize(
        (tvlChange1d * 0.5) + (tvlChange7d * 0.3) + (tvlChange1m * 0.2),
        -20, 50
    );
    
    const tvlAcceleration = normalize(tvlChange1d - (tvlChange7d / 7), -5, 10);
    
    const tvlRank = allProtocols.findIndex(p => p.id === protocol.id) + 1;
    const tvlRankScore = normalize(100 - tvlRank, 0, 100);
    
    return { tvlMomentum, tvlAcceleration, tvlRankScore };
}

function calculateMarketFeatures(market) {
    if (!market) return { priceStrength: 0.5, volumeMomentum: 0.5, liquidityScore: 0.5 };
    
    const priceScore = (
        (market.priceChange1h || 0) * 0.1 +
        (market.priceChange24h || 0) * 0.3 +
        (market.priceChange7d || 0) * 0.3 +
        (market.priceChange30d || 0) * 0.3
    );
    const priceStrength = normalize(priceScore, -30, 50);
    
    const volumeToMcap = market.marketCap > 0 
        ? (market.volume24h / market.marketCap) * 100 
        : 0;
    const volumeMomentum = normalize(volumeToMcap, 0, 20);
    
    const liquidityScore = normalize(
        Math.log10(Math.max(market.volume24h || 1, 1)),
        5, 9
    );
    
    return { priceStrength, volumeMomentum, liquidityScore };
}

function calculateYieldFeatures(yields) {
    if (!yields || yields.pools === 0) {
        return { yieldAttractiveness: 0.5, yieldSustainability: 0.5 };
    }
    
    const riskFreeRate = 5;
    const excessYield = yields.avgApy - riskFreeRate;
    const yieldAttractiveness = normalize(excessYield, 0, 50);
    
    // Sustainability based on deviation from 30d mean
    const topPool = yields.topPool;
    let yieldSustainability = 0.5;
    if (topPool && topPool.apyMean30d) {
        const deviation = Math.abs(topPool.apy - topPool.apyMean30d);
        yieldSustainability = normalize(20 - deviation, 0, 20);
    }
    
    return { yieldAttractiveness, yieldSustainability };
}

function calculateRevenueFeatures(fees, volume, tvl) {
    const fees24h = fees?.fees24h || 0;
    const feesChange = fees?.feesChange || 0;
    const volume24h = volume?.volume24h || 0;
    
    const revenueGrowth = normalize(feesChange, -30, 50);
    
    const feeToTvl = tvl > 0 ? (fees24h * 365 / tvl) * 100 : 0;
    const feeEfficiency = normalize(feeToTvl, 0, 30);
    
    return { revenueGrowth, feeEfficiency };
}

function calculateSentimentFeatures(fearGreed, category) {
    const fg = fearGreed?.current || 50;
    const fgTrend = fearGreed?.trend || 0;
    const sentimentScore = normalize(fg + (fgTrend * 0.5), 0, 100);
    
    const categoryMomentum = CATEGORY_MOMENTUM[category] || 1.0;
    
    return { sentimentScore, categoryMomentum };
}

function calculateRiskFeatures(protocol, market) {
    const hasAudit = protocol.audits && protocol.audits > 0;
    const ageMonths = protocol.listedAt 
        ? (Date.now() / 1000 - protocol.listedAt) / (30 * 24 * 3600)
        : 12;
    const ageFactor = Math.min(ageMonths / 24, 1);
    
    const chainCount = (protocol.chains || []).length;
    const chainFactor = Math.min(chainCount / 5, 1);
    
    const riskScore = (hasAudit ? 0.35 : 0) + (ageFactor * 0.35) + (chainFactor * 0.3);
    
    return { riskScore };
}

function calculateTrendStrength(sparkline) {
    if (!sparkline || sparkline.length < 7) return 0.5;
    
    const n = sparkline.length;
    const x = Array.from({length: n}, (_, i) => i);
    const sumX = x.reduce((s, v) => s + v, 0);
    const sumY = sparkline.reduce((s, v) => s + v, 0);
    const sumXY = x.reduce((s, v, i) => s + v * sparkline[i], 0);
    const sumX2 = x.reduce((s, v) => s + v * v, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;
    const normalizedSlope = avgPrice !== 0 ? (slope / avgPrice) * 100 : 0;
    
    return normalize(normalizedSlope, -5, 5);
}

function calculateAlphaScore(features) {
    let score = 0;
    let totalWeight = 0;
    
    for (const [feature, weight] of Object.entries(FEATURE_WEIGHTS)) {
        const value = features[feature];
        if (typeof value === 'number' && !isNaN(value)) {
            // Special handling for categoryMomentum (multiplier not normalized)
            if (feature === 'categoryMomentum') {
                score += normalize(value, 0.9, 1.3) * weight;
            } else {
                score += value * weight;
            }
            totalWeight += weight;
        }
    }
    
    return totalWeight > 0 ? (score / totalWeight) * 100 : 50;
}

function generateSignal(alphaScore, confidence) {
    let action, strength;
    
    if (alphaScore >= 80) {
        action = 'STRONG BUY';
        strength = 'very high';
    } else if (alphaScore >= 65) {
        action = 'BUY';
        strength = 'high';
    } else if (alphaScore >= 45) {
        action = 'HOLD';
        strength = 'moderate';
    } else if (alphaScore >= 30) {
        action = 'SELL';
        strength = 'low';
    } else {
        action = 'STRONG SELL';
        strength = 'very low';
    }
    
    // Downgrade for low confidence
    if (confidence < 0.4 && action.includes('STRONG')) {
        action = action === 'STRONG BUY' ? 'BUY' : 'SELL';
    }
    
    return { action, strength };
}

function generateReasoning(features, protocol, signal) {
    const reasons = [];
    
    if (features.tvlMomentum > 0.7) {
        reasons.push('Strong TVL growth momentum');
    } else if (features.tvlMomentum < 0.3) {
        reasons.push('TVL declining - capital outflows');
    }
    
    if (features.priceStrength > 0.7) {
        reasons.push('Strong price momentum');
    } else if (features.priceStrength < 0.3) {
        reasons.push('Weak price action');
    }
    
    if (features.yieldAttractiveness > 0.7) {
        reasons.push('Attractive yields vs risk-free rate');
    }
    
    if (features.revenueGrowth > 0.7) {
        reasons.push('Revenue growing rapidly');
    }
    
    if (features.categoryMomentum > 1.15) {
        reasons.push(`${protocol.category} is a trending category`);
    }
    
    if (features.riskScore < 0.4) {
        reasons.push('Elevated risk factors');
    }
    
    return reasons.length > 0 ? reasons : ['Mixed signals - exercise caution'];
}

async function analyzeProtocol(protocolSlug, allData) {
    const mapping = PROTOCOL_MAPPINGS[protocolSlug];
    if (!mapping) return null;
    
    const { protocols, yields, marketData, fearGreed, dexVolumes, fees } = allData;
    
    const protocol = protocols.find(p => p.id === protocolSlug);
    if (!protocol) return null;
    
    const protocolYields = yields.filter(y => 
        y.project?.toLowerCase() === protocolSlug.toLowerCase()
    );
    
    const yieldData = {
        pools: protocolYields.length,
        maxApy: Math.max(...protocolYields.map(y => y.apy), 0),
        avgApy: protocolYields.length > 0 
            ? protocolYields.reduce((s, y) => s + y.apy, 0) / protocolYields.length 
            : 0,
        topPool: protocolYields.sort((a, b) => b.tvlUsd - a.tvlUsd)[0] || null
    };
    
    const protocolVolume = dexVolumes.find(d => 
        d.name?.toLowerCase().includes(protocolSlug.split('-')[0])
    );
    
    const protocolFees = fees.find(f => 
        f.name?.toLowerCase().includes(protocolSlug.split('-')[0])
    );
    
    const market = marketData.find(m => m.id === mapping.coingecko);
    
    // Calculate all features
    const tvlFeatures = calculateTvlFeatures(protocol, protocols);
    const marketFeatures = calculateMarketFeatures(market);
    const yieldFeatures = calculateYieldFeatures(yieldData);
    const revenueFeatures = calculateRevenueFeatures(protocolFees, protocolVolume, protocol.tvl);
    const sentimentFeatures = calculateSentimentFeatures(fearGreed, mapping.category);
    const riskFeatures = calculateRiskFeatures(protocol, market);
    const trendStrength = calculateTrendStrength(market?.sparkline);
    
    const features = {
        ...tvlFeatures,
        ...marketFeatures,
        ...yieldFeatures,
        ...revenueFeatures,
        ...sentimentFeatures,
        ...riskFeatures,
        trendStrength
    };
    
    const alphaScore = calculateAlphaScore(features);
    
    // Calculate confidence
    const dataPoints = [
        protocol?.tvl > 0,
        market?.price > 0,
        yieldData.pools > 0,
        protocolVolume?.volume24h > 0,
        protocolFees?.fees24h > 0
    ];
    let confidence = 0.5 + (dataPoints.filter(Boolean).length * 0.1);
    confidence = Math.min(0.95, confidence);
    
    const signal = generateSignal(alphaScore, confidence);
    const reasoning = generateReasoning(features, { ...protocol, category: mapping.category }, signal);
    
    return {
        protocol: {
            id: protocolSlug,
            name: protocol.name,
            symbol: mapping.symbol,
            category: mapping.category,
            tvl: protocol.tvl,
            chains: protocol.chains?.slice(0, 5) || []
        },
        price: {
            current: market?.price || null,
            change24h: market?.priceChange24h || 0,
            change7d: market?.priceChange7d || 0,
            marketCap: market?.marketCap || 0
        },
        metrics: {
            tvlChange1d: protocol.tvlChange1d || 0,
            tvlChange7d: protocol.tvlChange7d || 0,
            maxApy: yieldData.maxApy,
            avgApy: yieldData.avgApy,
            volume24h: protocolVolume?.volume24h || 0,
            fees24h: protocolFees?.fees24h || 0
        },
        signal: {
            action: signal.action,
            strength: signal.strength,
            alphaScore: Math.round(alphaScore * 10) / 10,
            confidence: Math.round(confidence * 100),
            confidenceLevel: confidence >= 0.75 ? 'HIGH' : confidence >= 0.5 ? 'MEDIUM' : 'LOW'
        },
        features: {
            tvlMomentum: Math.round(features.tvlMomentum * 100),
            priceStrength: Math.round(features.priceStrength * 100),
            yieldScore: Math.round(features.yieldAttractiveness * 100),
            revenueScore: Math.round(features.revenueGrowth * 100),
            riskScore: Math.round(features.riskScore * 100),
            sentiment: Math.round(features.sentimentScore * 100)
        },
        reasoning,
        sentiment: {
            fearGreed: fearGreed?.current || 50,
            classification: fearGreed?.classification || 'Neutral'
        }
    };
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        // Fetch all data sources in parallel
        const [protocols, yields, dexVolumes, fees, fearGreed] = await Promise.all([
            fetchWithCache('protocols', DATA_SOURCES.DEFILLAMA.protocols, data => 
                data.filter(p => p.tvl > 50_000_000).map(p => ({
                    id: p.slug,
                    name: p.name,
                    symbol: p.symbol,
                    tvl: p.tvl,
                    tvlChange1d: p.change_1d || 0,
                    tvlChange7d: p.change_7d || 0,
                    tvlChange1m: p.change_1m || 0,
                    chains: p.chains || [],
                    category: p.category,
                    audits: p.audits,
                    listedAt: p.listedAt
                })).sort((a, b) => b.tvl - a.tvl)
            ),
            fetchWithCache('yields', DATA_SOURCES.DEFILLAMA.yields, data => 
                (data?.data || []).filter(y => y.tvlUsd > 1_000_000 && y.apy > 0 && y.apy < 1000)
            ),
            fetchWithCache('dexVolumes', DATA_SOURCES.DEFILLAMA.dexVolumes, data => 
                (data?.protocols || []).map(d => ({
                    name: d.name,
                    volume24h: d.total24h || 0,
                    volume7d: d.total7d || 0,
                    volumeChange: d.change_1d || 0
                }))
            ),
            fetchWithCache('fees', DATA_SOURCES.DEFILLAMA.fees, data => 
                (data?.protocols || []).map(f => ({
                    name: f.name,
                    fees24h: f.total24h || 0,
                    feesChange: f.change_1d || 0
                }))
            ),
            fetchWithCache('fearGreed', DATA_SOURCES.ALTERNATIVE.fearGreed, data => ({
                current: parseInt(data?.data?.[0]?.value) || 50,
                classification: data?.data?.[0]?.value_classification || 'Neutral',
                trend: data?.data ? parseInt(data.data[0]?.value) - parseInt(data.data[7]?.value) : 0
            }))
        ]);
        
        // Get CoinGecko IDs for tracked protocols
        const cgIds = Object.values(PROTOCOL_MAPPINGS).map(m => m.coingecko).join(',');
        const marketData = await fetchWithCache('market', 
            `${DATA_SOURCES.COINGECKO.markets}?vs_currency=usd&ids=${cgIds}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d`,
            data => (data || []).map(c => ({
                id: c.id,
                symbol: c.symbol?.toUpperCase(),
                price: c.current_price,
                marketCap: c.market_cap,
                volume24h: c.total_volume,
                priceChange1h: c.price_change_percentage_1h_in_currency || 0,
                priceChange24h: c.price_change_percentage_24h || 0,
                priceChange7d: c.price_change_percentage_7d_in_currency || 0,
                priceChange30d: c.price_change_percentage_30d_in_currency || 0,
                sparkline: c.sparkline_in_7d?.price || []
            }))
        );
        
        const allData = { protocols, yields, marketData, fearGreed, dexVolumes, fees };
        
        // Analyze all tracked protocols
        const protocolSlugs = Object.keys(PROTOCOL_MAPPINGS);
        const analyses = await Promise.all(
            protocolSlugs.map(slug => analyzeProtocol(slug, allData))
        );
        
        // Filter out nulls and sort by alpha score
        const validAnalyses = analyses.filter(a => a !== null)
            .sort((a, b) => b.signal.alphaScore - a.signal.alphaScore);
        
        // Add rankings
        validAnalyses.forEach((a, i) => {
            a.rank = i + 1;
        });
        
        // Categorize signals
        const signalGroups = {
            strongBuy: validAnalyses.filter(a => a.signal.action === 'STRONG BUY'),
            buy: validAnalyses.filter(a => a.signal.action === 'BUY'),
            hold: validAnalyses.filter(a => a.signal.action === 'HOLD'),
            sell: validAnalyses.filter(a => a.signal.action === 'SELL' || a.signal.action === 'STRONG SELL')
        };
        
        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            dataQuality: {
                protocols: protocols?.length || 0,
                yields: yields?.length || 0,
                marketData: marketData?.length || 0,
                sources: ['DeFiLlama', 'CoinGecko', 'Alternative.me'],
                status: protocols && marketData ? 'LIVE' : 'CACHED'
            },
            market: {
                fearGreed: fearGreed?.current || 50,
                sentiment: fearGreed?.classification || 'Neutral',
                trend: fearGreed?.trend || 0
            },
            summary: {
                total: validAnalyses.length,
                strongBuy: signalGroups.strongBuy.length,
                buy: signalGroups.buy.length,
                hold: signalGroups.hold.length,
                sell: signalGroups.sell.length
            },
            topPicks: validAnalyses.slice(0, 5),
            signals: validAnalyses,
            signalsByAction: signalGroups
        });
        
    } catch (error) {
        console.error('Alpha scanner error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
