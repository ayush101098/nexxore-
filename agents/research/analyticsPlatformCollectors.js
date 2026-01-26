/**
 * Analytics Platform Collectors
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Specialized collectors that aggregate data from multiple analytics platforms
 * and transform them into actionable signals for the research agent.
 * 
 * Data Sources Integrated:
 * - Dune Analytics (SQL queries)
 * - Flipside Crypto (SQL queries)
 * - DeFiLlama (TVL, yields, fees)
 * - DappRadar (DApp usage)
 * - Glassnode (On-chain health)
 * - IntoTheBlock (AI signals)
 * - DexScreener (DEX data)
 * - Block Explorers (Transaction data)
 * - The Graph (Subgraph queries)
 * - Solana-focused APIs
 */

const { multiSourceFetcher, API_ENDPOINTS } = require('./multiSourceDataFetcher');

// ═══════════════════════════════════════════════════════════════════════════
//                    TVL & PROTOCOL HEALTH COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class TVLHealthCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get comprehensive TVL data across all chains
     */
    async getGlobalTVL() {
        const [protocols, tvlHistory, chains] = await Promise.all([
            this.fetcher.getDefiLlamaProtocols(),
            this.fetcher.getDefiLlamaTVLHistory(),
            this.fetcher.fetchWithRetry(`${API_ENDPOINTS.DEFILLAMA.baseUrl}/v2/chains`)
        ]);

        const totalTvl = protocols.reduce((sum, p) => sum + (p.tvl || 0), 0);
        
        // TVL change calculations
        const tvlHistory7d = tvlHistory.slice(-7);
        const tvlChange7d = tvlHistory7d.length >= 2 
            ? ((tvlHistory7d[tvlHistory7d.length - 1]?.tvl - tvlHistory7d[0]?.tvl) / tvlHistory7d[0]?.tvl) * 100
            : 0;

        return {
            timestamp: Date.now(),
            totalTvl,
            totalProtocols: protocols.length,
            tvlChange7d,
            
            // Top chains by TVL
            chainBreakdown: chains?.slice(0, 15).map(c => ({
                chain: c.name,
                tvl: c.tvl,
                dominance: (c.tvl / totalTvl) * 100
            })),
            
            // Category breakdown
            categoryBreakdown: this.aggregateByCategory(protocols),
            
            // Top protocols
            topProtocols: protocols.slice(0, 20).map(p => ({
                name: p.name,
                symbol: p.symbol,
                tvl: p.tvl,
                change24h: p.change_1d,
                change7d: p.change_7d,
                category: p.category,
                chains: p.chains
            })),
            
            // Signals
            signals: {
                tvlTrend: tvlChange7d > 5 ? 'BULLISH' : tvlChange7d < -5 ? 'BEARISH' : 'NEUTRAL',
                dominantChain: chains?.[0]?.name,
                hotCategory: this.getHotCategory(protocols)
            }
        };
    }

    /**
     * Get protocol-specific TVL analysis
     */
    async getProtocolTVL(protocolSlug) {
        const data = await this.fetcher.getDefiLlamaProtocol(protocolSlug);
        if (!data) return null;

        const tvlHistory = data.tvl || [];
        const recentTvl = tvlHistory.slice(-30);

        return {
            protocol: protocolSlug,
            name: data.name,
            currentTvl: data.tvl,
            
            // Multi-chain breakdown
            chainTvls: data.chainTvls,
            
            // TVL metrics
            metrics: {
                change24h: data.change_1d,
                change7d: data.change_7d,
                change30d: data.change_1m,
                
                // Momentum
                momentum: this.calculateMomentum(recentTvl),
                
                // Trend
                trend: data.change_7d > 0 ? 'UP' : data.change_7d < 0 ? 'DOWN' : 'FLAT'
            },
            
            // Signal
            signal: this.generateTvlSignal(data)
        };
    }

    aggregateByCategory(protocols) {
        const categories = {};
        for (const p of protocols) {
            const cat = p.category || 'Other';
            if (!categories[cat]) {
                categories[cat] = { tvl: 0, count: 0 };
            }
            categories[cat].tvl += p.tvl || 0;
            categories[cat].count++;
        }
        return Object.entries(categories)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.tvl - a.tvl)
            .slice(0, 10);
    }

    getHotCategory(protocols) {
        const categoryGrowth = {};
        for (const p of protocols) {
            const cat = p.category || 'Other';
            if (!categoryGrowth[cat]) {
                categoryGrowth[cat] = { growth: 0, count: 0 };
            }
            categoryGrowth[cat].growth += p.change_7d || 0;
            categoryGrowth[cat].count++;
        }
        
        const avgGrowth = Object.entries(categoryGrowth)
            .map(([name, data]) => ({ name, avgGrowth: data.growth / data.count }))
            .sort((a, b) => b.avgGrowth - a.avgGrowth);
        
        return avgGrowth[0]?.name;
    }

    calculateMomentum(tvlHistory) {
        if (tvlHistory.length < 7) return 0;
        const recent = tvlHistory.slice(-7);
        const older = tvlHistory.slice(-14, -7);
        
        const recentAvg = recent.reduce((sum, d) => sum + (d?.totalLiquidityUSD || d || 0), 0) / recent.length;
        const olderAvg = older.reduce((sum, d) => sum + (d?.totalLiquidityUSD || d || 0), 0) / older.length;
        
        return olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    }

    generateTvlSignal(data) {
        const change7d = data.change_7d || 0;
        const change30d = data.change_1m || 0;
        
        if (change7d > 20 && change30d > 30) return { signal: 'STRONG_BULLISH', confidence: 0.85 };
        if (change7d > 10 && change30d > 15) return { signal: 'BULLISH', confidence: 0.70 };
        if (change7d > 0 && change30d > 0) return { signal: 'SLIGHTLY_BULLISH', confidence: 0.55 };
        if (change7d < -20 && change30d < -30) return { signal: 'STRONG_BEARISH', confidence: 0.85 };
        if (change7d < -10 && change30d < -15) return { signal: 'BEARISH', confidence: 0.70 };
        if (change7d < 0 && change30d < 0) return { signal: 'SLIGHTLY_BEARISH', confidence: 0.55 };
        return { signal: 'NEUTRAL', confidence: 0.50 };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    YIELD & REVENUE COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class YieldRevenueCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get top yield opportunities across all protocols
     */
    async getTopYields(minTvl = 1000000, maxResults = 50) {
        const yields = await this.fetcher.getDefiLlamaYields();
        
        // Filter and sort
        const filtered = yields
            .filter(y => y.tvlUsd >= minTvl && y.apy > 0 && y.apy < 1000) // Filter extreme/fake APYs
            .sort((a, b) => b.apy - a.apy)
            .slice(0, maxResults);

        return {
            timestamp: Date.now(),
            totalPools: yields.length,
            
            yields: filtered.map(y => ({
                pool: y.symbol,
                project: y.project,
                chain: y.chain,
                tvl: y.tvlUsd,
                apy: y.apy,
                apyBase: y.apyBase,
                apyReward: y.apyReward,
                
                // Risk metrics
                ilRisk: y.ilRisk,
                stablecoin: y.stablecoin,
                exposure: y.exposure,
                
                // Quality score
                qualityScore: this.calculateYieldQuality(y)
            })),
            
            // Aggregations
            byChain: this.aggregateYieldsByChain(filtered),
            byProject: this.aggregateYieldsByProject(filtered),
            
            // Signals
            signals: {
                avgApy: filtered.reduce((sum, y) => sum + y.apy, 0) / filtered.length,
                medianApy: this.median(filtered.map(y => y.apy)),
                sustainableYields: filtered.filter(y => y.apyBase > y.apyReward).length
            }
        };
    }

    /**
     * Get protocol fees and revenue data
     */
    async getProtocolFees() {
        const fees = await this.fetcher.getDefiLlamaFees();
        if (!fees) return null;

        const protocols = fees.protocols || [];
        
        return {
            timestamp: Date.now(),
            
            // Top by 24h fees
            topByFees24h: protocols
                .filter(p => p.total24h > 0)
                .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
                .slice(0, 20)
                .map(p => ({
                    name: p.name,
                    fees24h: p.total24h,
                    fees7d: p.total7d,
                    fees30d: p.total30d,
                    revenue24h: p.revenue24h,
                    change7d: p.change_7d,
                    chain: p.chains?.[0]
                })),
            
            // Revenue leaders
            topByRevenue: protocols
                .filter(p => p.revenue24h > 0)
                .sort((a, b) => (b.revenue24h || 0) - (a.revenue24h || 0))
                .slice(0, 20)
                .map(p => ({
                    name: p.name,
                    revenue24h: p.revenue24h,
                    fees24h: p.total24h,
                    revenueShare: p.total24h > 0 ? (p.revenue24h / p.total24h) * 100 : 0
                })),
            
            // Signals
            signals: {
                totalFees24h: protocols.reduce((sum, p) => sum + (p.total24h || 0), 0),
                topFeeGenerator: protocols[0]?.name,
                feeGrowthLeader: this.getFeeGrowthLeader(protocols)
            }
        };
    }

    calculateYieldQuality(yield_) {
        let score = 50;
        
        // Base APY vs Reward APY (sustainable = good)
        if (yield_.apyBase > yield_.apyReward) score += 20;
        
        // TVL (higher = more trusted)
        if (yield_.tvlUsd > 10000000) score += 15;
        else if (yield_.tvlUsd > 1000000) score += 10;
        
        // Stablecoin pool (lower IL risk)
        if (yield_.stablecoin) score += 10;
        
        // IL risk penalty
        if (yield_.ilRisk === 'high') score -= 15;
        else if (yield_.ilRisk === 'yes') score -= 10;
        
        // Extreme APY penalty
        if (yield_.apy > 100) score -= 10;
        if (yield_.apy > 500) score -= 20;
        
        return Math.max(0, Math.min(100, score));
    }

    aggregateYieldsByChain(yields) {
        const chains = {};
        for (const y of yields) {
            const chain = y.chain || 'Unknown';
            if (!chains[chain]) {
                chains[chain] = { count: 0, avgApy: 0, totalTvl: 0 };
            }
            chains[chain].count++;
            chains[chain].avgApy += y.apy;
            chains[chain].totalTvl += y.tvlUsd;
        }
        
        return Object.entries(chains)
            .map(([name, data]) => ({
                chain: name,
                poolCount: data.count,
                avgApy: data.avgApy / data.count,
                totalTvl: data.totalTvl
            }))
            .sort((a, b) => b.totalTvl - a.totalTvl)
            .slice(0, 10);
    }

    aggregateYieldsByProject(yields) {
        const projects = {};
        for (const y of yields) {
            const project = y.project || 'Unknown';
            if (!projects[project]) {
                projects[project] = { count: 0, avgApy: 0, totalTvl: 0 };
            }
            projects[project].count++;
            projects[project].avgApy += y.apy;
            projects[project].totalTvl += y.tvlUsd;
        }
        
        return Object.entries(projects)
            .map(([name, data]) => ({
                project: name,
                poolCount: data.count,
                avgApy: data.avgApy / data.count,
                totalTvl: data.totalTvl
            }))
            .sort((a, b) => b.totalTvl - a.totalTvl)
            .slice(0, 10);
    }

    getFeeGrowthLeader(protocols) {
        return protocols
            .filter(p => p.change_7d > 0)
            .sort((a, b) => (b.change_7d || 0) - (a.change_7d || 0))[0]?.name;
    }

    median(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    DEX & TRADING COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class DEXTradingCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get DEX volume overview
     */
    async getDEXVolumes() {
        const [dexData, derivatives] = await Promise.all([
            this.fetcher.getDefiLlamaDEXVolumes(),
            this.fetcher.getDefiLlamaDerivatives()
        ]);

        const protocols = dexData?.protocols || [];
        const derivProtocols = derivatives?.protocols || [];

        return {
            timestamp: Date.now(),
            
            // Spot DEX volumes
            spotDEX: {
                total24h: dexData?.total24h,
                total7d: dexData?.total7d,
                change24h: dexData?.change_1d,
                
                topByVolume: protocols
                    .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
                    .slice(0, 15)
                    .map(p => ({
                        name: p.name,
                        volume24h: p.total24h,
                        volume7d: p.total7d,
                        change24h: p.change_1d,
                        chains: p.chains
                    }))
            },
            
            // Derivatives/Perps volumes
            derivatives: {
                total24h: derivatives?.total24h,
                total7d: derivatives?.total7d,
                
                topByVolume: derivProtocols
                    .sort((a, b) => (b.total24h || 0) - (a.total24h || 0))
                    .slice(0, 15)
                    .map(p => ({
                        name: p.name,
                        volume24h: p.total24h,
                        volume7d: p.total7d,
                        change24h: p.change_1d
                    }))
            },
            
            // Signals
            signals: {
                spotVsDerivRatio: dexData?.total24h && derivatives?.total24h 
                    ? dexData.total24h / derivatives.total24h 
                    : null,
                volumeTrend: dexData?.change_1d > 0 ? 'INCREASING' : 'DECREASING',
                topDEX: protocols[0]?.name,
                topPerp: derivProtocols[0]?.name
            }
        };
    }

    /**
     * Get trending tokens from DexScreener
     */
    async getTrendingTokens() {
        const trending = await this.fetcher.getDexScreenerTrending();
        
        return {
            timestamp: Date.now(),
            tokens: trending?.map(t => ({
                token: t.tokenAddress,
                chain: t.chainId,
                name: t.description,
                boostedAt: t.boostedAt,
                amount: t.amount
            })) || []
        };
    }

    /**
     * Get token pair analysis
     */
    async getTokenPairAnalysis(tokenSymbol) {
        const searchResult = await this.fetcher.searchDexScreener(tokenSymbol);
        const pairs = searchResult?.pairs || [];

        if (pairs.length === 0) return null;

        // Aggregate across all pairs
        const totalVolume24h = pairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0);
        const totalLiquidity = pairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);
        const avgPrice = pairs.reduce((sum, p) => sum + (parseFloat(p.priceUsd) || 0), 0) / pairs.length;

        // Group by chain
        const byChain = {};
        for (const p of pairs) {
            const chain = p.chainId;
            if (!byChain[chain]) {
                byChain[chain] = { pairs: 0, volume: 0, liquidity: 0 };
            }
            byChain[chain].pairs++;
            byChain[chain].volume += p.volume?.h24 || 0;
            byChain[chain].liquidity += p.liquidity?.usd || 0;
        }

        return {
            symbol: tokenSymbol,
            timestamp: Date.now(),
            
            aggregated: {
                priceUsd: avgPrice,
                volume24h: totalVolume24h,
                liquidity: totalLiquidity,
                pairCount: pairs.length
            },
            
            byChain: Object.entries(byChain)
                .map(([chain, data]) => ({ chain, ...data }))
                .sort((a, b) => b.volume - a.volume),
            
            topPairs: pairs.slice(0, 10).map(p => ({
                dex: p.dexId,
                chain: p.chainId,
                pairAddress: p.pairAddress,
                baseToken: p.baseToken?.symbol,
                quoteToken: p.quoteToken?.symbol,
                priceUsd: p.priceUsd,
                priceChange24h: p.priceChange?.h24,
                volume24h: p.volume?.h24,
                liquidity: p.liquidity?.usd,
                txns24h: p.txns?.h24?.buys + p.txns?.h24?.sells
            })),
            
            signals: {
                priceDirection: pairs[0]?.priceChange?.h24 > 0 ? 'UP' : 'DOWN',
                volumeHealth: totalVolume24h > totalLiquidity * 0.1 ? 'HEALTHY' : 'LOW',
                liquidityDepth: totalLiquidity > 1000000 ? 'DEEP' : totalLiquidity > 100000 ? 'MODERATE' : 'SHALLOW'
            }
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    ON-CHAIN HEALTH COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class OnchainHealthCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get comprehensive on-chain health metrics
     */
    async getOnchainHealth(asset = 'BTC') {
        const [
            activeAddresses,
            exchangeBalance,
            nupl
        ] = await Promise.all([
            this.fetcher.getGlassnodeActiveAddresses(asset),
            this.fetcher.getGlassnodeExchangeBalance(asset),
            this.fetcher.getGlassnodeNUPL(asset)
        ]);

        return {
            asset,
            timestamp: Date.now(),
            
            // Active addresses trend
            activity: {
                current: activeAddresses?.[activeAddresses?.length - 1]?.v,
                change7d: this.calculateChange(activeAddresses, 7),
                change30d: this.calculateChange(activeAddresses, 30),
                trend: this.calculateTrend(activeAddresses)
            },
            
            // Exchange balance (supply on exchanges)
            exchanges: {
                balance: exchangeBalance?.[exchangeBalance?.length - 1]?.v,
                change7d: this.calculateChange(exchangeBalance, 7),
                change30d: this.calculateChange(exchangeBalance, 30),
                // Declining = bullish (moving to cold storage)
                signal: this.calculateChange(exchangeBalance, 7) < 0 ? 'ACCUMULATION' : 'DISTRIBUTION'
            },
            
            // NUPL (Net Unrealized Profit/Loss)
            nupl: {
                value: nupl?.[nupl?.length - 1]?.v,
                zone: this.getNUPLZone(nupl?.[nupl?.length - 1]?.v),
                trend: this.calculateTrend(nupl)
            },
            
            // Combined signal
            signals: {
                overallHealth: this.calculateOverallHealth(activeAddresses, exchangeBalance, nupl),
                accumulation: this.calculateChange(exchangeBalance, 7) < -1,
                networkGrowth: this.calculateChange(activeAddresses, 7) > 0
            }
        };
    }

    calculateChange(data, days) {
        if (!data || data.length < days + 1) return 0;
        const current = data[data.length - 1]?.v;
        const past = data[data.length - days - 1]?.v;
        return past > 0 ? ((current - past) / past) * 100 : 0;
    }

    calculateTrend(data) {
        if (!data || data.length < 7) return 'UNKNOWN';
        const recent = data.slice(-7);
        const increasing = recent.filter((d, i) => i > 0 && d.v > recent[i - 1].v).length;
        if (increasing >= 5) return 'STRONG_UP';
        if (increasing >= 4) return 'UP';
        if (increasing <= 2) return 'DOWN';
        if (increasing <= 1) return 'STRONG_DOWN';
        return 'SIDEWAYS';
    }

    getNUPLZone(nupl) {
        if (nupl === null || nupl === undefined) return 'UNKNOWN';
        if (nupl > 0.75) return 'EUPHORIA';
        if (nupl > 0.5) return 'GREED';
        if (nupl > 0.25) return 'OPTIMISM';
        if (nupl > 0) return 'HOPE';
        if (nupl > -0.25) return 'FEAR';
        return 'CAPITULATION';
    }

    calculateOverallHealth(activeAddresses, exchangeBalance, nupl) {
        let score = 50;
        
        // Active addresses growth = bullish
        const activityChange = this.calculateChange(activeAddresses, 7);
        if (activityChange > 5) score += 15;
        else if (activityChange > 0) score += 5;
        else if (activityChange < -5) score -= 15;
        
        // Exchange balance declining = bullish (accumulation)
        const exchangeChange = this.calculateChange(exchangeBalance, 7);
        if (exchangeChange < -2) score += 15;
        else if (exchangeChange < 0) score += 5;
        else if (exchangeChange > 2) score -= 15;
        
        // NUPL zone
        const nuplValue = nupl?.[nupl?.length - 1]?.v;
        if (nuplValue > 0.5) score += 10; // Profit zone
        else if (nuplValue < 0) score -= 10; // Loss zone
        
        if (score >= 70) return 'VERY_HEALTHY';
        if (score >= 55) return 'HEALTHY';
        if (score >= 45) return 'NEUTRAL';
        if (score >= 35) return 'WEAK';
        return 'VERY_WEAK';
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    BRIDGE & CROSS-CHAIN COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class BridgeCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get bridge volumes and flows
     */
    async getBridgeData() {
        const bridges = await this.fetcher.getDefiLlamaBridges();
        if (!bridges) return null;

        const bridgeList = bridges.bridges || [];

        return {
            timestamp: Date.now(),
            
            // Top bridges by volume
            topBridges: bridgeList
                .sort((a, b) => (b.lastDailyVolume || 0) - (a.lastDailyVolume || 0))
                .slice(0, 15)
                .map(b => ({
                    name: b.name,
                    displayName: b.displayName,
                    volume24h: b.lastDailyVolume,
                    volumeChange: b.dayBeforeLastVolume 
                        ? ((b.lastDailyVolume - b.dayBeforeLastVolume) / b.dayBeforeLastVolume) * 100 
                        : 0,
                    chains: b.chains
                })),
            
            // Volume by destination chain
            chainFlows: this.aggregateBridgeFlows(bridgeList),
            
            // Signals
            signals: {
                totalVolume24h: bridgeList.reduce((sum, b) => sum + (b.lastDailyVolume || 0), 0),
                topBridge: bridgeList[0]?.name,
                volumeTrend: this.getBridgeVolumeTrend(bridgeList)
            }
        };
    }

    aggregateBridgeFlows(bridges) {
        const chainVolumes = {};
        for (const bridge of bridges) {
            for (const chain of (bridge.chains || [])) {
                if (!chainVolumes[chain]) {
                    chainVolumes[chain] = 0;
                }
                // Distribute volume across chains (simplified)
                chainVolumes[chain] += (bridge.lastDailyVolume || 0) / (bridge.chains?.length || 1);
            }
        }
        
        return Object.entries(chainVolumes)
            .map(([chain, volume]) => ({ chain, volume }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10);
    }

    getBridgeVolumeTrend(bridges) {
        const increasing = bridges.filter(b => 
            b.lastDailyVolume > b.dayBeforeLastVolume
        ).length;
        
        if (increasing > bridges.length * 0.6) return 'INCREASING';
        if (increasing < bridges.length * 0.4) return 'DECREASING';
        return 'STABLE';
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    STABLECOIN FLOW COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class StablecoinCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get stablecoin supply and flow data
     */
    async getStablecoinData() {
        const data = await this.fetcher.getDefiLlamaStablecoins();
        if (!data) return null;

        const stables = data.peggedAssets || [];

        return {
            timestamp: Date.now(),
            
            // Total stablecoin supply
            totalSupply: stables.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0),
            
            // Top stablecoins
            topStables: stables
                .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
                .slice(0, 10)
                .map(s => ({
                    name: s.name,
                    symbol: s.symbol,
                    supply: s.circulating?.peggedUSD,
                    change7d: s.circulatingPrevDay?.peggedUSD 
                        ? ((s.circulating?.peggedUSD - s.circulatingPrevDay?.peggedUSD) / s.circulatingPrevDay?.peggedUSD) * 100
                        : 0,
                    chains: Object.keys(s.chainCirculating || {})
                })),
            
            // Supply by chain
            byChain: this.aggregateStablesByChain(stables),
            
            // Signals
            signals: {
                supplyGrowing: this.isSupplyGrowing(stables),
                dominantStable: stables[0]?.symbol,
                chainWithMostStables: this.getTopStableChain(stables)
            }
        };
    }

    aggregateStablesByChain(stables) {
        const chains = {};
        for (const stable of stables) {
            for (const [chain, data] of Object.entries(stable.chainCirculating || {})) {
                if (!chains[chain]) {
                    chains[chain] = 0;
                }
                chains[chain] += data?.peggedUSD || 0;
            }
        }
        
        return Object.entries(chains)
            .map(([chain, supply]) => ({ chain, supply }))
            .sort((a, b) => b.supply - a.supply)
            .slice(0, 10);
    }

    isSupplyGrowing(stables) {
        let growing = 0;
        let declining = 0;
        
        for (const s of stables.slice(0, 10)) {
            const current = s.circulating?.peggedUSD || 0;
            const prev = s.circulatingPrevDay?.peggedUSD || 0;
            if (current > prev) growing++;
            else if (current < prev) declining++;
        }
        
        return growing > declining;
    }

    getTopStableChain(stables) {
        const chains = this.aggregateStablesByChain(stables);
        return chains[0]?.chain;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    FUNDRAISING & AIRDROP COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class FundraisingCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get recent fundraising rounds
     */
    async getFundraisingData() {
        const raises = await this.fetcher.getDefiLlamaRaises();
        if (!raises) return null;

        const recent = raises.raises || [];
        const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);

        // Filter to recent raises
        const recentRaises = recent
            .filter(r => new Date(r.date).getTime() > last30Days)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        return {
            timestamp: Date.now(),
            
            // Recent raises
            recentRaises: recentRaises.slice(0, 20).map(r => ({
                name: r.name,
                amount: r.amount,
                round: r.round,
                date: r.date,
                category: r.category,
                chains: r.chains,
                leadInvestors: r.leadInvestors,
                valuation: r.valuation
            })),
            
            // Aggregations
            totalRaised30d: recentRaises.reduce((sum, r) => sum + (r.amount || 0), 0),
            raisesCount30d: recentRaises.length,
            
            // By category
            byCategory: this.aggregateRaisesByCategory(recentRaises),
            
            // Top investors
            topInvestors: this.getTopInvestors(recentRaises),
            
            // Potential airdrops (well-funded, no token)
            potentialAirdrops: recentRaises
                .filter(r => r.amount > 10000000 && !r.tokenSymbol)
                .map(r => ({
                    name: r.name,
                    raised: r.amount,
                    round: r.round,
                    category: r.category
                }))
        };
    }

    aggregateRaisesByCategory(raises) {
        const categories = {};
        for (const r of raises) {
            const cat = r.category || 'Other';
            if (!categories[cat]) {
                categories[cat] = { count: 0, total: 0 };
            }
            categories[cat].count++;
            categories[cat].total += r.amount || 0;
        }
        
        return Object.entries(categories)
            .map(([name, data]) => ({ category: name, ...data }))
            .sort((a, b) => b.total - a.total);
    }

    getTopInvestors(raises) {
        const investors = {};
        for (const r of raises) {
            for (const inv of (r.leadInvestors || [])) {
                if (!investors[inv]) {
                    investors[inv] = { deals: 0, totalAmount: 0 };
                }
                investors[inv].deals++;
                investors[inv].totalAmount += r.amount || 0;
            }
        }
        
        return Object.entries(investors)
            .map(([name, data]) => ({ investor: name, ...data }))
            .sort((a, b) => b.deals - a.deals)
            .slice(0, 10);
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    SUBGRAPH DATA COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════

class SubgraphCollector {
    constructor() {
        this.fetcher = multiSourceFetcher;
    }

    /**
     * Get Uniswap pool data from The Graph
     */
    async getUniswapData() {
        const pools = await this.fetcher.getUniswapPools(50);
        if (!pools?.pools) return null;

        return {
            timestamp: Date.now(),
            
            pools: pools.pools.map(p => ({
                id: p.id,
                pair: `${p.token0?.symbol}/${p.token1?.symbol}`,
                feeTier: p.feeTier / 10000, // Convert to percentage
                tvl: parseFloat(p.totalValueLockedUSD),
                volume: parseFloat(p.volumeUSD),
                txCount: parseInt(p.txCount)
            })),
            
            // Aggregations
            totalTvl: pools.pools.reduce((sum, p) => sum + parseFloat(p.totalValueLockedUSD || 0), 0),
            totalVolume: pools.pools.reduce((sum, p) => sum + parseFloat(p.volumeUSD || 0), 0)
        };
    }

    /**
     * Get Aave market data from The Graph
     */
    async getAaveData() {
        const markets = await this.fetcher.getAaveMarkets();
        if (!markets?.markets) return null;

        return {
            timestamp: Date.now(),
            
            markets: markets.markets.map(m => ({
                id: m.id,
                name: m.name,
                token: m.inputToken?.symbol,
                tvl: parseFloat(m.totalValueLockedUSD),
                totalBorrow: parseFloat(m.totalBorrowBalanceUSD),
                totalDeposit: parseFloat(m.totalDepositBalanceUSD),
                utilizationRate: m.totalDepositBalanceUSD > 0 
                    ? (parseFloat(m.totalBorrowBalanceUSD) / parseFloat(m.totalDepositBalanceUSD)) * 100
                    : 0
            })),
            
            // Aggregations
            totalTvl: markets.markets.reduce((sum, m) => sum + parseFloat(m.totalValueLockedUSD || 0), 0)
        };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                    MASTER COLLECTOR (UNIFIED INTERFACE)
// ═══════════════════════════════════════════════════════════════════════════

class AnalyticsPlatformCollector {
    constructor() {
        this.tvl = new TVLHealthCollector();
        this.yields = new YieldRevenueCollector();
        this.dex = new DEXTradingCollector();
        this.onchain = new OnchainHealthCollector();
        this.bridges = new BridgeCollector();
        this.stablecoins = new StablecoinCollector();
        this.fundraising = new FundraisingCollector();
        this.subgraphs = new SubgraphCollector();
    }

    /**
     * Get complete market snapshot from all sources
     */
    async getCompleteSnapshot() {
        console.log('📊 Fetching complete market snapshot from all analytics platforms...');
        
        const [
            tvlData,
            yieldData,
            feeData,
            dexData,
            bridgeData,
            stablecoinData,
            fundraisingData
        ] = await Promise.all([
            this.tvl.getGlobalTVL(),
            this.yields.getTopYields(),
            this.yields.getProtocolFees(),
            this.dex.getDEXVolumes(),
            this.bridges.getBridgeData(),
            this.stablecoins.getStablecoinData(),
            this.fundraising.getFundraisingData()
        ]);

        return {
            timestamp: Date.now(),
            sources: ['DeFiLlama', 'DexScreener', 'Glassnode', 'The Graph'],
            
            tvl: tvlData,
            yields: yieldData,
            fees: feeData,
            dex: dexData,
            bridges: bridgeData,
            stablecoins: stablecoinData,
            fundraising: fundraisingData,
            
            // Overall market signals
            marketSignals: this.generateMarketSignals(tvlData, dexData, stablecoinData)
        };
    }

    /**
     * Get protocol-specific analysis
     */
    async getProtocolAnalysis(protocolSlug) {
        const [tvlData, tokenData] = await Promise.all([
            this.tvl.getProtocolTVL(protocolSlug),
            this.dex.getTokenPairAnalysis(protocolSlug)
        ]);

        return {
            timestamp: Date.now(),
            protocol: protocolSlug,
            tvl: tvlData,
            trading: tokenData
        };
    }

    generateMarketSignals(tvl, dex, stablecoins) {
        const signals = {};
        
        // TVL trend signal
        if (tvl?.signals?.tvlTrend) {
            signals.tvlTrend = tvl.signals.tvlTrend;
        }
        
        // Volume trend
        if (dex?.signals?.volumeTrend) {
            signals.volumeTrend = dex.signals.volumeTrend;
        }
        
        // Stablecoin signal
        if (stablecoins?.signals?.supplyGrowing !== undefined) {
            signals.stablecoinSupply = stablecoins.signals.supplyGrowing ? 'GROWING' : 'DECLINING';
        }
        
        // Overall market sentiment
        let bullishSignals = 0;
        let bearishSignals = 0;
        
        if (signals.tvlTrend === 'BULLISH') bullishSignals++;
        if (signals.tvlTrend === 'BEARISH') bearishSignals++;
        if (signals.volumeTrend === 'INCREASING') bullishSignals++;
        if (signals.volumeTrend === 'DECREASING') bearishSignals++;
        if (signals.stablecoinSupply === 'GROWING') bullishSignals++;
        if (signals.stablecoinSupply === 'DECLINING') bearishSignals++;
        
        if (bullishSignals >= 2) signals.overall = 'BULLISH';
        else if (bearishSignals >= 2) signals.overall = 'BEARISH';
        else signals.overall = 'NEUTRAL';
        
        return signals;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                              EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

const analyticsCollector = new AnalyticsPlatformCollector();

module.exports = {
    AnalyticsPlatformCollector,
    TVLHealthCollector,
    YieldRevenueCollector,
    DEXTradingCollector,
    OnchainHealthCollector,
    BridgeCollector,
    StablecoinCollector,
    FundraisingCollector,
    SubgraphCollector,
    analyticsCollector
};
