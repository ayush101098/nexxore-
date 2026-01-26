/**
 * Analytics API Endpoint
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Serves aggregated analytics data from multiple platforms:
 * - DeFiLlama (TVL, yields, fees, stablecoins)
 * - DexScreener (trending tokens, pairs)
 * - Protocol analytics
 * - Market overview
 */

// Data fetching utilities
const DEFILLAMA_BASE = 'https://api.llama.fi';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

// Cache for API responses
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

async function fetchWithCache(url, cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setCache(cacheKey, data);
        return data;
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//                           DATA FETCHERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchProtocols() {
    return fetchWithCache(`${DEFILLAMA_BASE}/protocols`, 'protocols');
}

async function fetchYields() {
    const data = await fetchWithCache('https://yields.llama.fi/pools', 'yields');
    return data?.data || [];
}

async function fetchFees() {
    return fetchWithCache(`${DEFILLAMA_BASE}/overview/fees`, 'fees');
}

async function fetchDexVolumes() {
    return fetchWithCache(`${DEFILLAMA_BASE}/overview/dexs`, 'dexVolumes');
}

async function fetchDerivatives() {
    return fetchWithCache(`${DEFILLAMA_BASE}/overview/derivatives`, 'derivatives');
}

async function fetchStablecoins() {
    return fetchWithCache('https://stablecoins.llama.fi/stablecoins', 'stablecoins');
}

async function fetchBridges() {
    return fetchWithCache('https://bridges.llama.fi/bridges', 'bridges');
}

async function fetchChains() {
    return fetchWithCache(`${DEFILLAMA_BASE}/v2/chains`, 'chains');
}

async function fetchRaises() {
    return fetchWithCache(`${DEFILLAMA_BASE}/raises`, 'raises');
}

async function fetchDexScreenerTrending() {
    return fetchWithCache(`${DEXSCREENER_BASE}/token-boosts/top/v1`, 'trending');
}

async function fetchDexScreenerSearch(query) {
    return fetchWithCache(`${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`, `search:${query}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//                           API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/analytics/overview
 * Complete market overview
 */
async function getOverview(req, res) {
    try {
        const [protocols, chains, dexVolumes, derivatives, stablecoins, fees] = await Promise.all([
            fetchProtocols(),
            fetchChains(),
            fetchDexVolumes(),
            fetchDerivatives(),
            fetchStablecoins(),
            fetchFees()
        ]);

        const totalTvl = protocols?.reduce((sum, p) => sum + (p.tvl || 0), 0) || 0;
        const totalStables = stablecoins?.peggedAssets?.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0) || 0;

        // Top protocols by TVL
        const topProtocols = (protocols || [])
            .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
            .slice(0, 20)
            .map(p => ({
                name: p.name,
                symbol: p.symbol,
                tvl: p.tvl,
                change24h: p.change_1d,
                change7d: p.change_7d,
                category: p.category,
                chains: p.chains?.slice(0, 3),
                logo: p.logo
            }));

        // Top chains
        const topChains = (chains || [])
            .slice(0, 15)
            .map(c => ({
                name: c.name,
                tvl: c.tvl,
                dominance: totalTvl > 0 ? ((c.tvl / totalTvl) * 100).toFixed(2) : 0
            }));

        // Category breakdown
        const categories = {};
        for (const p of (protocols || [])) {
            const cat = p.category || 'Other';
            if (!categories[cat]) categories[cat] = { tvl: 0, count: 0 };
            categories[cat].tvl += p.tvl || 0;
            categories[cat].count++;
        }
        const categoryBreakdown = Object.entries(categories)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.tvl - a.tvl)
            .slice(0, 12);

        // Volume data
        const spotVolume24h = dexVolumes?.total24h || 0;
        const derivVolume24h = derivatives?.total24h || 0;

        // Top DEXes
        const topDexes = (dexVolumes?.protocols || [])
            .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
            .slice(0, 10)
            .map(d => ({
                name: d.name,
                volume24h: d.total24h,
                change24h: d.change_1d,
                chains: d.chains?.slice(0, 3)
            }));

        // Top Perps
        const topPerps = (derivatives?.protocols || [])
            .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
            .slice(0, 10)
            .map(d => ({
                name: d.name,
                volume24h: d.total24h,
                change24h: d.change_1d
            }));

        // Market signals
        const tvlChange7d = topProtocols.reduce((sum, p) => sum + (p.change7d || 0), 0) / topProtocols.length;
        const volumeChange = dexVolumes?.change_1d || 0;

        res.json({
            timestamp: Date.now(),
            summary: {
                totalTvl,
                totalStablecoins: totalStables,
                spotVolume24h,
                derivVolume24h,
                totalVolume24h: spotVolume24h + derivVolume24h,
                protocolCount: protocols?.length || 0
            },
            signals: {
                tvlTrend: tvlChange7d > 5 ? 'BULLISH' : tvlChange7d < -5 ? 'BEARISH' : 'NEUTRAL',
                volumeTrend: volumeChange > 0 ? 'INCREASING' : 'DECREASING',
                marketSentiment: tvlChange7d > 5 && volumeChange > 0 ? 'BULLISH' : 
                                 tvlChange7d < -5 && volumeChange < 0 ? 'BEARISH' : 'NEUTRAL'
            },
            topProtocols,
            topChains,
            categoryBreakdown,
            topDexes,
            topPerps
        });
    } catch (error) {
        console.error('Overview error:', error);
        res.status(500).json({ error: 'Failed to fetch overview' });
    }
}

/**
 * GET /api/analytics/yields
 * Top yield opportunities
 */
async function getYields(req, res) {
    try {
        const yields = await fetchYields();
        
        const minTvl = parseInt(req.query?.minTvl) || 100000;
        const limit = parseInt(req.query?.limit) || 50;

        const filtered = yields
            .filter(y => y.tvlUsd >= minTvl && y.apy > 0 && y.apy < 1000)
            .sort((a, b) => b.apy - a.apy)
            .slice(0, limit)
            .map(y => ({
                pool: y.symbol,
                project: y.project,
                chain: y.chain,
                tvl: y.tvlUsd,
                apy: y.apy,
                apyBase: y.apyBase,
                apyReward: y.apyReward,
                stablecoin: y.stablecoin,
                ilRisk: y.ilRisk,
                // Quality score
                quality: calculateYieldQuality(y)
            }));

        // Aggregate by chain
        const byChain = {};
        for (const y of filtered) {
            if (!byChain[y.chain]) byChain[y.chain] = { count: 0, avgApy: 0, totalTvl: 0 };
            byChain[y.chain].count++;
            byChain[y.chain].avgApy += y.apy;
            byChain[y.chain].totalTvl += y.tvl;
        }
        const chainSummary = Object.entries(byChain)
            .map(([chain, data]) => ({ chain, count: data.count, avgApy: data.avgApy / data.count, totalTvl: data.totalTvl }))
            .sort((a, b) => b.totalTvl - a.totalTvl);

        // Aggregate by project
        const byProject = {};
        for (const y of filtered) {
            if (!byProject[y.project]) byProject[y.project] = { count: 0, avgApy: 0, totalTvl: 0 };
            byProject[y.project].count++;
            byProject[y.project].avgApy += y.apy;
            byProject[y.project].totalTvl += y.tvl;
        }
        const projectSummary = Object.entries(byProject)
            .map(([project, data]) => ({ project, count: data.count, avgApy: data.avgApy / data.count, totalTvl: data.totalTvl }))
            .sort((a, b) => b.totalTvl - a.totalTvl)
            .slice(0, 15);

        res.json({
            timestamp: Date.now(),
            totalPools: yields.length,
            filteredCount: filtered.length,
            yields: filtered,
            byChain: chainSummary.slice(0, 10),
            byProject: projectSummary,
            stats: {
                avgApy: filtered.reduce((sum, y) => sum + y.apy, 0) / filtered.length,
                medianApy: median(filtered.map(y => y.apy)),
                sustainableCount: filtered.filter(y => (y.apyBase || 0) > (y.apyReward || 0)).length
            }
        });
    } catch (error) {
        console.error('Yields error:', error);
        res.status(500).json({ error: 'Failed to fetch yields' });
    }
}

/**
 * GET /api/analytics/protocols
 * Tradeable protocols with signals
 */
async function getProtocols(req, res) {
    try {
        const [protocols, fees] = await Promise.all([
            fetchProtocols(),
            fetchFees()
        ]);

        const category = req.query?.category;
        const chain = req.query?.chain;
        const limit = parseInt(req.query?.limit) || 50;

        let filtered = protocols || [];
        
        if (category) {
            filtered = filtered.filter(p => p.category?.toLowerCase() === category.toLowerCase());
        }
        if (chain) {
            filtered = filtered.filter(p => p.chains?.some(c => c.toLowerCase() === chain.toLowerCase()));
        }

        // Get fee data mapping
        const feeMap = {};
        for (const f of (fees?.protocols || [])) {
            feeMap[f.name?.toLowerCase()] = f;
        }

        const result = filtered
            .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
            .slice(0, limit)
            .map(p => {
                const feeData = feeMap[p.name?.toLowerCase()];
                const signal = generateProtocolSignal(p, feeData);
                
                return {
                    name: p.name,
                    symbol: p.symbol,
                    slug: p.slug,
                    tvl: p.tvl,
                    change24h: p.change_1d,
                    change7d: p.change_7d,
                    change30d: p.change_1m,
                    category: p.category,
                    chains: p.chains,
                    logo: p.logo,
                    fees24h: feeData?.total24h,
                    revenue24h: feeData?.revenue24h,
                    signal: signal.signal,
                    signalStrength: signal.strength,
                    signalReasons: signal.reasons
                };
            });

        res.json({
            timestamp: Date.now(),
            count: result.length,
            protocols: result
        });
    } catch (error) {
        console.error('Protocols error:', error);
        res.status(500).json({ error: 'Failed to fetch protocols' });
    }
}

/**
 * GET /api/analytics/chains
 * Chain analytics
 */
async function getChains(req, res) {
    try {
        const [chains, protocols, dexVolumes] = await Promise.all([
            fetchChains(),
            fetchProtocols(),
            fetchDexVolumes()
        ]);

        const totalTvl = chains?.reduce((sum, c) => sum + (c.tvl || 0), 0) || 0;

        // Protocol count per chain
        const protocolCount = {};
        for (const p of (protocols || [])) {
            for (const chain of (p.chains || [])) {
                protocolCount[chain] = (protocolCount[chain] || 0) + 1;
            }
        }

        // DEX volume per chain
        const chainVolumes = {};
        for (const d of (dexVolumes?.protocols || [])) {
            for (const chain of (d.chains || [])) {
                chainVolumes[chain] = (chainVolumes[chain] || 0) + (d.total24h || 0) / (d.chains?.length || 1);
            }
        }

        const result = (chains || []).map(c => ({
            name: c.name,
            tvl: c.tvl,
            dominance: totalTvl > 0 ? ((c.tvl / totalTvl) * 100).toFixed(2) : 0,
            protocolCount: protocolCount[c.name] || 0,
            dexVolume24h: chainVolumes[c.name] || 0,
            tokenSymbol: c.tokenSymbol
        }));

        res.json({
            timestamp: Date.now(),
            totalTvl,
            chains: result
        });
    } catch (error) {
        console.error('Chains error:', error);
        res.status(500).json({ error: 'Failed to fetch chains' });
    }
}

/**
 * GET /api/analytics/stablecoins
 * Stablecoin analytics
 */
async function getStablecoins(req, res) {
    try {
        const stables = await fetchStablecoins();
        const assets = stables?.peggedAssets || [];

        const totalSupply = assets.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0);

        const result = assets
            .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
            .slice(0, 20)
            .map(s => {
                const current = s.circulating?.peggedUSD || 0;
                const prev = s.circulatingPrevDay?.peggedUSD || current;
                const change24h = prev > 0 ? ((current - prev) / prev) * 100 : 0;
                
                return {
                    name: s.name,
                    symbol: s.symbol,
                    supply: current,
                    change24h,
                    dominance: totalSupply > 0 ? ((current / totalSupply) * 100).toFixed(2) : 0,
                    chains: Object.keys(s.chainCirculating || {}).slice(0, 5)
                };
            });

        // Chain breakdown
        const byChain = {};
        for (const s of assets) {
            for (const [chain, data] of Object.entries(s.chainCirculating || {})) {
                byChain[chain] = (byChain[chain] || 0) + (data?.peggedUSD || 0);
            }
        }
        const chainBreakdown = Object.entries(byChain)
            .map(([chain, supply]) => ({ chain, supply }))
            .sort((a, b) => b.supply - a.supply)
            .slice(0, 10);

        res.json({
            timestamp: Date.now(),
            totalSupply,
            stablecoins: result,
            byChain: chainBreakdown,
            signals: {
                supplyTrend: result.filter(s => s.change24h > 0).length > result.length / 2 ? 'GROWING' : 'DECLINING',
                dominant: result[0]?.symbol
            }
        });
    } catch (error) {
        console.error('Stablecoins error:', error);
        res.status(500).json({ error: 'Failed to fetch stablecoins' });
    }
}

/**
 * GET /api/analytics/trending
 * Trending tokens from DexScreener
 */
async function getTrending(req, res) {
    try {
        const trending = await fetchDexScreenerTrending();

        res.json({
            timestamp: Date.now(),
            tokens: (trending || []).slice(0, 30).map(t => ({
                address: t.tokenAddress,
                chain: t.chainId,
                description: t.description,
                amount: t.amount,
                icon: t.icon,
                links: t.links
            }))
        });
    } catch (error) {
        console.error('Trending error:', error);
        res.status(500).json({ error: 'Failed to fetch trending' });
    }
}

/**
 * GET /api/analytics/raises
 * Recent fundraising rounds
 */
async function getRaises(req, res) {
    try {
        const raises = await fetchRaises();
        const allRaises = raises?.raises || [];

        const days = parseInt(req.query?.days) || 30;
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

        const recent = allRaises
            .filter(r => new Date(r.date).getTime() > cutoff)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const totalRaised = recent.reduce((sum, r) => sum + (r.amount || 0), 0);

        // By category
        const byCategory = {};
        for (const r of recent) {
            const cat = r.category || 'Other';
            if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
            byCategory[cat].count++;
            byCategory[cat].total += r.amount || 0;
        }

        // Top investors
        const investors = {};
        for (const r of recent) {
            for (const inv of (r.leadInvestors || [])) {
                if (!investors[inv]) investors[inv] = { deals: 0, total: 0 };
                investors[inv].deals++;
                investors[inv].total += r.amount || 0;
            }
        }
        const topInvestors = Object.entries(investors)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.deals - a.deals)
            .slice(0, 10);

        // Potential airdrops (well-funded, no token)
        const potentialAirdrops = recent
            .filter(r => (r.amount || 0) > 5000000)
            .slice(0, 20)
            .map(r => ({
                name: r.name,
                raised: r.amount,
                round: r.round,
                category: r.category,
                date: r.date,
                leadInvestors: r.leadInvestors?.slice(0, 3)
            }));

        res.json({
            timestamp: Date.now(),
            period: `${days} days`,
            totalRaised,
            raisesCount: recent.length,
            raises: recent.slice(0, 30).map(r => ({
                name: r.name,
                amount: r.amount,
                round: r.round,
                category: r.category,
                date: r.date,
                leadInvestors: r.leadInvestors?.slice(0, 3),
                valuation: r.valuation
            })),
            byCategory: Object.entries(byCategory)
                .map(([name, data]) => ({ category: name, ...data }))
                .sort((a, b) => b.total - a.total),
            topInvestors,
            potentialAirdrops
        });
    } catch (error) {
        console.error('Raises error:', error);
        res.status(500).json({ error: 'Failed to fetch raises' });
    }
}

/**
 * GET /api/analytics/fees
 * Protocol fees & revenue
 */
async function getFees(req, res) {
    try {
        const fees = await fetchFees();
        const protocols = fees?.protocols || [];

        const topByFees = protocols
            .filter(p => p.total24h > 0)
            .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
            .slice(0, 25)
            .map(p => ({
                name: p.name,
                fees24h: p.total24h,
                fees7d: p.total7d,
                revenue24h: p.revenue24h,
                change7d: p.change_7d,
                chains: p.chains?.slice(0, 3),
                revenueShare: p.total24h > 0 ? ((p.revenue24h || 0) / p.total24h * 100).toFixed(1) : 0
            }));

        res.json({
            timestamp: Date.now(),
            total24h: fees?.total24h,
            total7d: fees?.total7d,
            protocols: topByFees,
            topFeeGenerator: topByFees[0]?.name,
            topRevenueGenerator: protocols
                .filter(p => p.revenue24h > 0)
                .sort((a, b) => (b.revenue24h || 0) - (a.revenue24h || 0))[0]?.name
        });
    } catch (error) {
        console.error('Fees error:', error);
        res.status(500).json({ error: 'Failed to fetch fees' });
    }
}

/**
 * GET /api/analytics/search?q={query}
 * Search tokens on DexScreener
 */
async function searchTokens(req, res) {
    try {
        const query = req.query?.q;
        if (!query) {
            return res.status(400).json({ error: 'Query parameter q is required' });
        }

        const result = await fetchDexScreenerSearch(query);
        const pairs = result?.pairs || [];

        // Aggregate by token
        const totalVolume = pairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0);
        const totalLiquidity = pairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);

        res.json({
            timestamp: Date.now(),
            query,
            pairCount: pairs.length,
            aggregated: {
                volume24h: totalVolume,
                liquidity: totalLiquidity,
                avgPrice: pairs.length > 0 
                    ? pairs.reduce((sum, p) => sum + (parseFloat(p.priceUsd) || 0), 0) / pairs.length 
                    : 0
            },
            pairs: pairs.slice(0, 20).map(p => ({
                dex: p.dexId,
                chain: p.chainId,
                pairAddress: p.pairAddress,
                baseToken: p.baseToken?.symbol,
                quoteToken: p.quoteToken?.symbol,
                priceUsd: p.priceUsd,
                priceChange24h: p.priceChange?.h24,
                volume24h: p.volume?.h24,
                liquidity: p.liquidity?.usd
            }))
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search' });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//                           HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function calculateYieldQuality(y) {
    let score = 50;
    if ((y.apyBase || 0) > (y.apyReward || 0)) score += 20;
    if (y.tvlUsd > 10000000) score += 15;
    else if (y.tvlUsd > 1000000) score += 10;
    if (y.stablecoin) score += 10;
    if (y.ilRisk === 'high') score -= 15;
    if (y.apy > 100) score -= 10;
    if (y.apy > 500) score -= 20;
    return Math.max(0, Math.min(100, score));
}

function generateProtocolSignal(protocol, feeData) {
    const reasons = [];
    let bullish = 0;
    let bearish = 0;

    // TVL momentum
    if (protocol.change_7d > 20) { bullish += 2; reasons.push('Strong TVL growth'); }
    else if (protocol.change_7d > 5) { bullish += 1; reasons.push('TVL growing'); }
    else if (protocol.change_7d < -20) { bearish += 2; reasons.push('Significant TVL decline'); }
    else if (protocol.change_7d < -5) { bearish += 1; reasons.push('TVL declining'); }

    // 30d trend
    if (protocol.change_1m > 30) { bullish += 1; reasons.push('Strong monthly growth'); }
    else if (protocol.change_1m < -30) { bearish += 1; reasons.push('Monthly decline'); }

    // Fee revenue (if available)
    if (feeData?.total24h > 100000) { bullish += 1; reasons.push('High fee generation'); }
    if (feeData?.change_7d > 20) { bullish += 1; reasons.push('Growing fees'); }

    const score = bullish - bearish;
    let signal, strength;
    
    if (score >= 3) { signal = 'BULLISH'; strength = 'HIGH'; }
    else if (score >= 1) { signal = 'BULLISH'; strength = 'MEDIUM'; }
    else if (score <= -3) { signal = 'BEARISH'; strength = 'HIGH'; }
    else if (score <= -1) { signal = 'BEARISH'; strength = 'MEDIUM'; }
    else { signal = 'NEUTRAL'; strength = 'LOW'; }

    return { signal, strength, reasons };
}

function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ═══════════════════════════════════════════════════════════════════════════
//                           EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    getOverview,
    getYields,
    getProtocols,
    getChains,
    getStablecoins,
    getTrending,
    getRaises,
    getFees,
    searchTokens
};
