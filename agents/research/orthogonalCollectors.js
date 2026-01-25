/**
 * Orthogonal Data Collectors
 * Organized by signal class, not platform
 * 
 * A. Price & Derivatives (market expectations)
 * B. Onchain Behavior (who is acting) 
 * C. Liquidity & DeFi Structure (can price move?)
 * D. Protocol Fundamentals (slow but powerful)
 */

const { dataAggregator } = require('./dataAggregator');

class OrthogonalDataCollector {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * A. PRICE & DERIVATIVES
     * Use for: direction, leverage stress, reversals
     * 
     * Key metrics:
     * - Funding rate (level + change)
     * - Open interest delta
     * - Basis (perp vs spot)
     * - Volatility (realized vs implied if available)
     */
    async collectDerivativesSignals(symbol) {
        const cacheKey = `derivatives:${symbol}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const signals = {
                symbol,
                timestamp: Date.now(),
                
                // Funding rate data
                fundingRate: 0,
                fundingHistory: [],
                fundingChange24h: 0,
                
                // Open Interest
                openInterest: 0,
                oiChange24h: 0,
                oiChange7d: 0,
                oiHistory: [],
                
                // Basis (if available)
                basis: 0, // perp_price - spot_price
                basisHistory: [],
                
                // Volume profile
                volume24h: 0,
                volumeHistory: [],
                
                // Volatility
                volatility7d: 0,
                volatilityHistory: []
            };

            // Fetch from Coinglass, Binance, Bybit APIs
            // This would integrate with your derivatives_collector.py
            // For now, placeholder for structure
            
            // Derived signals
            signals.derived = {
                // Funding spike + flat price = crowded trade
                crowdedLong: signals.fundingRate > 0.01 && signals.fundingChange24h > 0.005,
                crowdedShort: signals.fundingRate < -0.01 && signals.fundingChange24h < -0.005,
                
                // OI up + volatility down = compression
                compression: signals.oiChange24h > 0.1 && signals.volatility7d < signals.volatilityHistory[7],
                
                // OI declining + funding neutral = derisking
                derisking: signals.oiChange24h < -0.05 && Math.abs(signals.fundingRate) < 0.005
            };

            this._setCache(cacheKey, signals);
            return signals;

        } catch (error) {
            console.error(`Error collecting derivatives signals for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * B. ONCHAIN BEHAVIOR
     * Use for: conviction vs speculation
     * 
     * Key metrics:
     * - Active addresses (Δ, not absolute)
     * - Whale net flows
     * - Exchange inflow / outflow  
     * - Stablecoin supply change
     */
    async collectOnchainSignals(protocol) {
        const cacheKey = `onchain:${protocol}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const signals = {
                protocol,
                timestamp: Date.now(),
                
                // Address activity
                activeAddresses24h: 0,
                activeAddressesChange7d: 0, // Δ is what matters
                newAddresses24h: 0,
                
                // Whale behavior (>$100k holders)
                whaleNetFlows24h: 0, // positive = accumulation
                whaleNetFlows7d: 0,
                whaleHistory: [],
                
                // Exchange flows
                exchangeInflow24h: 0,
                exchangeOutflow24h: 0,
                exchangeNetFlows: 0, // negative = outflows (bullish)
                exchangeHistory: [],
                
                // Stablecoin context (broader market)
                stablecoinSupplyChange: 0, // system-wide dry powder
                stablecoinInflowToChain: 0
            };

            // Fetch from Glassnode, CryptoQuant, Dune, DefiLlama
            // Integration points with existing collectors
            
            // Derived signals
            signals.derived = {
                // Price up + exchange inflows up = distribution risk
                distributionRisk: signals.exchangeNetFlows > 0, // positive inflows = selling
                
                // Stablecoin inflow spike = dry powder entering
                dryPowderEntry: signals.stablecoinInflowToChain > signals.stablecoinSupplyChange * 0.01,
                
                // Whale accumulation + exchange outflows = strong hands
                strongHands: signals.whaleNetFlows24h > 0 && signals.exchangeNetFlows < 0,
                
                // New addresses + active addresses up = retail FOMO
                retailFOMO: signals.newAddresses24h > signals.activeAddresses24h * 0.2
            };

            this._setCache(cacheKey, signals);
            return signals;

        } catch (error) {
            console.error(`Error collecting onchain signals for ${protocol}:`, error);
            return null;
        }
    }

    /**
     * C. LIQUIDITY & DEFI STRUCTURE
     * Use for: execution realism
     * 
     * Key metrics:
     * - TVL delta (chain + protocol)
     * - Pool depth
     * - Slippage at size
     * - Borrow utilization
     */
    async collectLiquiditySignals(protocol) {
        const cacheKey = `liquidity:${protocol}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            // Fetch protocol data from DeFiLlama
            const protocolData = await dataAggregator.aggregateProtocolData(protocol);
            
            const signals = {
                protocol,
                timestamp: Date.now(),
                
                // TVL metrics
                tvl: protocolData.protocol?.tvl || 0,
                tvlChange24h: protocolData.protocol?.tvlChange1d || 0,
                tvlChange7d: protocolData.protocol?.tvlChange7d || 0,
                tvlHistory: [],
                
                // Pool depth (for DEXs)
                poolDepth: 0,
                avgDepth30d: 0,
                depthHistory: [],
                
                // Slippage estimates
                slippage1pct: 0, // slippage for 1% of pool
                slippage5pct: 0,
                
                // Borrow metrics (for lending protocols)
                totalBorrowed: 0,
                totalSupplied: 0,
                borrowUtilization: 0, // borrowed / supplied
                borrowRateAvg: 0,
                utilizationHistory: []
            };

            // Calculate derived metrics
            if (signals.totalSupplied > 0) {
                signals.borrowUtilization = signals.totalBorrowed / signals.totalSupplied;
            }

            // Derived signals
            signals.derived = {
                // TVL rising faster than price = organic adoption
                organicAdoption: signals.tvlChange7d > 0.1, // 10%+ growth
                
                // High utilization + rising borrow rates = leverage stress
                leverageStress: signals.borrowUtilization > 0.85,
                
                // TVL declining + depth declining = liquidity crisis
                liquidityCrisis: signals.tvlChange24h < -0.05 && 
                                signals.poolDepth < signals.avgDepth30d * 0.7,
                
                // Stable TVL + low utilization = healthy
                healthy: Math.abs(signals.tvlChange7d) < 0.05 && 
                        signals.borrowUtilization < 0.75
            };

            this._setCache(cacheKey, signals);
            return signals;

        } catch (error) {
            console.error(`Error collecting liquidity signals for ${protocol}:`, error);
            return null;
        }
    }

    /**
     * D. PROTOCOL FUNDAMENTALS
     * Use for: medium-term positioning
     * 
     * Key metrics:
     * - Fee / revenue growth
     * - User retention
     * - Emissions vs fees ratio
     * - Incentive dependency
     */
    async collectFundamentalsSignals(protocol) {
        const cacheKey = `fundamentals:${protocol}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const protocolData = await dataAggregator.aggregateProtocolData(protocol);
            const yields = protocolData.yields;
            
            const signals = {
                protocol,
                timestamp: Date.now(),
                
                // Revenue metrics
                fees24h: 0,
                fees7d: 0,
                fees30d: 0,
                feeGrowth7d: 0,
                feeHistory: [],
                
                // User metrics
                activeUsers24h: 0,
                activeUsers7d: 0,
                userRetention: 0, // 7d active / 30d active
                
                // Tokenomics
                emissions24h: 0,
                totalApy: yields?.maxApy || 0,
                feesApy: 0,
                emissionsApy: 0,
                emissionsRatio: 0, // emissions / total yield
                
                // Sustainability
                incentiveRunway: 0, // months of incentives remaining
                treasuryValue: 0,
                
                // Growth attribution
                tvlChangeOrganic: 0, // growth without new incentives
                tvlChangeIncentivized: 0
            };

            // Calculate emissions ratio
            if (signals.totalApy > 0) {
                signals.emissionsRatio = signals.emissionsApy / signals.totalApy;
                signals.feesApy = signals.totalApy - signals.emissionsApy;
            }

            // Derived signals
            signals.derived = {
                // Fees growing while incentives flat = real demand
                realDemand: signals.feeGrowth7d > 0.1 && signals.emissionsRatio < 0.7,
                
                // TVL growth driven purely by emissions = fragile
                fragile: signals.emissionsRatio > 0.8 && signals.tvlChangeOrganic < 0.05,
                
                // Fee growth + user retention = product-market fit
                productMarketFit: signals.feeGrowth7d > 0.1 && signals.userRetention > 0.5,
                
                // High emissions + low runway = vampire risk
                vampireRisk: signals.emissionsRatio > 0.75 && signals.incentiveRunway < 3,
                
                // Sustainable: fees > 30% of yield
                sustainable: signals.feesApy / signals.totalApy > 0.3
            };

            this._setCache(cacheKey, signals);
            return signals;

        } catch (error) {
            console.error(`Error collecting fundamentals signals for ${protocol}:`, error);
            return null;
        }
    }

    /**
     * Fetch All Signals for a Protocol
     * Returns orthogonal signal classes
     */
    async fetchAllSignals(protocol, options = {}) {
        const { includeDerivatives = true } = options;
        
        const results = await Promise.allSettled([
            includeDerivatives ? this.collectDerivativesSignals(protocol) : null,
            this.collectOnchainSignals(protocol),
            this.collectLiquiditySignals(protocol),
            this.collectFundamentalsSignals(protocol)
        ]);

        return {
            protocol,
            timestamp: Date.now(),
            derivatives: results[0].status === 'fulfilled' ? results[0].value : null,
            onchain: results[1].status === 'fulfilled' ? results[1].value : null,
            liquidity: results[2].status === 'fulfilled' ? results[2].value : null,
            fundamentals: results[3].status === 'fulfilled' ? results[3].value : null,
            errors: results
                .filter(r => r.status === 'rejected')
                .map(r => r.reason?.message || 'Unknown error')
        };
    }

    // Cache helpers
    _getCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    _setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
}

module.exports = { OrthogonalDataCollector };
