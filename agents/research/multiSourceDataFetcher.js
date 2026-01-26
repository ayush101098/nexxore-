/**
 * Multi-Source Data Fetcher
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Comprehensive data aggregation from all major analytics platforms:
 * 
 * 🔍 Query & Custom Analytics:    Dune Analytics, Flipside Crypto
 * 📊 Protocol Dashboards:         DeFiLlama, DappRadar
 * 🧩 On-Chain Health:             Glassnode, IntoTheBlock
 * 📈 Chain & Wallet Tracking:     DexScreener, Etherscan, Solscan
 * 🟣 Solana-Focused:              Step Finance, Goldsky, Solana Basis
 * 🛠️ Middleware & Indexing:       The Graph (Subgraphs)
 * 
 * This module provides a unified interface for fetching data across all sources.
 */

// ═══════════════════════════════════════════════════════════════════════════
//                           API ENDPOINTS REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const API_ENDPOINTS = {
    // ─────────────────────────────────────────────────────────────────────────
    // 🔍 QUERY & CUSTOM ANALYTICS PLATFORMS
    // ─────────────────────────────────────────────────────────────────────────
    DUNE: {
        baseUrl: 'https://api.dune.com/api/v1',
        endpoints: {
            executeQuery: '/query/{query_id}/execute',
            getResults: '/execution/{execution_id}/results',
            getLatestResults: '/query/{query_id}/results'
        },
        // Popular pre-built queries (fork these on Dune)
        publicQueries: {
            ethWhaleWallets: '2360954',           // Top ETH whale movements
            defiTvlByChain: '2614316',            // TVL breakdown by chain
            dexVolumeAggregated: '2891024',       // DEX volume across chains
            nftMarketOverview: '2567812',         // NFT market metrics
            stablecoinFlows: '2789456',           // Stablecoin movements
            bridgeVolumes: '2901234',             // Cross-chain bridge activity
            l2Comparison: '2845612',              // L2 metrics comparison
            topProtocolsByFees: '2934567'         // Revenue leaders
        },
        rateLimit: { calls: 40, window: 60000 }  // 40 calls per minute (free tier)
    },

    FLIPSIDE: {
        baseUrl: 'https://api.flipsidecrypto.com/api/v2',
        endpoints: {
            createQuery: '/queries',
            getQuery: '/queries/{query_id}',
            getQueryResults: '/queries/{query_id}/data/latest'
        },
        // Pre-built query templates
        templates: {
            walletActivity: `SELECT * FROM ethereum.core.fact_transactions WHERE block_timestamp > CURRENT_DATE - 7`,
            protocolTvl: `SELECT * FROM ethereum.defi.ez_lending_borrows ORDER BY block_timestamp DESC LIMIT 1000`,
            dexSwaps: `SELECT * FROM ethereum.defi.ez_dex_swaps WHERE block_timestamp > CURRENT_DATE - 1`
        },
        rateLimit: { calls: 100, window: 60000 }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 📊 PROTOCOL & ECOSYSTEM DASHBOARDS
    // ─────────────────────────────────────────────────────────────────────────
    DEFILLAMA: {
        baseUrl: 'https://api.llama.fi',
        endpoints: {
            // TVL Data
            protocols: '/protocols',
            protocol: '/protocol/{protocol}',
            tvlHistory: '/v2/historicalChainTvl',
            tvlByChain: '/v2/historicalChainTvl/{chain}',
            chains: '/v2/chains',
            
            // Yields
            yields: 'https://yields.llama.fi/pools',
            yieldChart: 'https://yields.llama.fi/chart/{pool}',
            
            // Stablecoins
            stablecoins: 'https://stablecoins.llama.fi/stablecoins',
            stablecoinCharts: 'https://stablecoins.llama.fi/stablecoincharts/all',
            
            // Bridges
            bridges: 'https://bridges.llama.fi/bridges',
            bridgeVolume: 'https://bridges.llama.fi/bridgevolume/all',
            
            // Volumes & Fees
            dexVolumes: '/overview/dexs',
            fees: '/overview/fees',
            feesChart: '/summary/fees/{protocol}',
            revenue: '/summary/revenue/{protocol}',
            
            // Options & Derivatives
            options: '/overview/options',
            derivatives: '/overview/derivatives',
            
            // Unlocks
            unlocks: 'https://api.llama.fi/emission/unlocks',
            
            // Raises
            raises: 'https://api.llama.fi/raises'
        },
        rateLimit: { calls: 300, window: 60000 } // Very generous
    },

    DAPPRADAR: {
        baseUrl: 'https://api.dappradar.com/4tsxo4vuhotaojtl',
        endpoints: {
            dapps: '/dapps',
            dappDetails: '/dapps/{dapp_id}',
            rankings: '/dapps/rankings',
            nfts: '/nfts',
            defi: '/defi',
            chains: '/chains',
            tokens: '/tokens'
        },
        rateLimit: { calls: 100, window: 60000 }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 🧩 ON-CHAIN HEALTH & MARKET DATA
    // ─────────────────────────────────────────────────────────────────────────
    GLASSNODE: {
        baseUrl: 'https://api.glassnode.com/v1',
        endpoints: {
            // Addresses
            activeAddresses: '/metrics/addresses/active_count',
            newAddresses: '/metrics/addresses/new_non_zero_count',
            
            // Supply
            supplyInProfit: '/metrics/supply/profit_relative',
            supplyInLoss: '/metrics/supply/loss_relative',
            
            // Exchange
            exchangeBalance: '/metrics/distribution/balance_exchanges',
            exchangeInflow: '/metrics/transactions/transfers_to_exchanges_count',
            exchangeOutflow: '/metrics/transactions/transfers_from_exchanges_count',
            exchangeNetflow: '/metrics/transactions/transfers_net_exchange_count',
            
            // NUPL
            nupl: '/metrics/indicators/net_unrealized_profit_loss',
            
            // Holders
            hodlWaves: '/metrics/supply/hodl_waves',
            
            // Fees
            feesTotal: '/metrics/fees/volume_sum',
            
            // Mining/Staking
            hashRate: '/metrics/mining/hash_rate_mean'
        },
        freeMetrics: [
            'active_count', 'new_non_zero_count', 'balance_exchanges',
            'transfers_to_exchanges_count', 'transfers_from_exchanges_count'
        ],
        rateLimit: { calls: 10, window: 60000 } // Free tier limited
    },

    INTOTHEBLOCK: {
        baseUrl: 'https://api.intotheblock.com/v1',
        endpoints: {
            // Ownership
            concentration: '/ownership/concentration',
            byTimeHeld: '/ownership/by_time_held',
            
            // Transactions
            largeTransactions: '/transactions/large',
            transactionStats: '/transactions/stats',
            
            // Network
            networkGrowth: '/network/growth',
            activeAddresses: '/network/active_addresses',
            
            // Signals
            bullBearSignal: '/signals/bull_bear',
            netNetworkGrowth: '/signals/net_network_growth'
        },
        rateLimit: { calls: 50, window: 60000 }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 📈 CHAIN & WALLET TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    DEXSCREENER: {
        baseUrl: 'https://api.dexscreener.com',
        endpoints: {
            // Token search
            searchPairs: '/latest/dex/search',
            
            // Pair data
            pairsByChain: '/latest/dex/pairs/{chain}/{pairAddresses}',
            
            // Token data
            tokensByAddress: '/latest/dex/tokens/{tokenAddresses}',
            
            // Boosted tokens (trending)
            boostedTokens: '/token-boosts/top/v1',
            
            // Orders
            orders: '/orders/v1/{chainId}/{pairAddress}'
        },
        chains: {
            ethereum: 'ethereum',
            solana: 'solana',
            base: 'base',
            arbitrum: 'arbitrum',
            optimism: 'optimism',
            polygon: 'polygon',
            avalanche: 'avalanche',
            bsc: 'bsc'
        },
        rateLimit: { calls: 300, window: 60000 }
    },

    ETHERSCAN: {
        baseUrl: 'https://api.etherscan.io/api',
        endpoints: {
            // Account
            balance: '?module=account&action=balance',
            balanceMulti: '?module=account&action=balancemulti',
            txList: '?module=account&action=txlist',
            txListInternal: '?module=account&action=txlistinternal',
            tokenTx: '?module=account&action=tokentx',
            tokenNftTx: '?module=account&action=tokennfttx',
            
            // Contract
            contractAbi: '?module=contract&action=getabi',
            contractSource: '?module=contract&action=getsourcecode',
            
            // Transaction
            txReceiptStatus: '?module=transaction&action=gettxreceiptstatus',
            
            // Block
            blockReward: '?module=block&action=getblockreward',
            
            // Stats
            ethSupply: '?module=stats&action=ethsupply',
            ethPrice: '?module=stats&action=ethprice',
            
            // Gas
            gasOracle: '?module=gastracker&action=gasoracle'
        },
        l2Variants: {
            arbitrum: 'https://api.arbiscan.io/api',
            optimism: 'https://api-optimistic.etherscan.io/api',
            base: 'https://api.basescan.org/api',
            polygon: 'https://api.polygonscan.com/api'
        },
        rateLimit: { calls: 5, window: 1000 } // 5 calls/sec free tier
    },

    SOLSCAN: {
        baseUrl: 'https://api.solscan.io',
        endpoints: {
            // Account
            accountInfo: '/account/{address}',
            accountTokens: '/account/tokens',
            accountTransactions: '/account/transactions',
            accountStakeAccounts: '/account/stake',
            
            // Token
            tokenMeta: '/token/meta',
            tokenHolders: '/token/holders',
            tokenTransfer: '/token/transfer',
            
            // Transaction
            transactionDetail: '/transaction/{signature}',
            transactionLast: '/transaction/last',
            
            // Block
            blockLast: '/block/last',
            blockTransactions: '/block/transactions',
            
            // Market
            tokenMarket: '/market/token/{tokenAddress}'
        },
        rateLimit: { calls: 100, window: 60000 }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 🟣 SOLANA-FOCUSED ANALYTICS
    // ─────────────────────────────────────────────────────────────────────────
    STEP_FINANCE: {
        baseUrl: 'https://api.step.finance',
        endpoints: {
            // Portfolio
            portfolio: '/v1/portfolio/{walletAddress}',
            
            // TVL
            tvl: '/v1/tvl',
            protocolTvl: '/v1/tvl/{protocol}',
            
            // Yields
            yields: '/v1/yields',
            yieldsByProtocol: '/v1/yields/{protocol}',
            
            // NFT
            nftCollection: '/v1/nft/collection/{collectionAddress}'
        },
        rateLimit: { calls: 60, window: 60000 }
    },

    JUPITER: {
        baseUrl: 'https://quote-api.jup.ag/v6',
        priceApi: 'https://price.jup.ag/v6',
        endpoints: {
            quote: '/quote',
            swap: '/swap',
            price: '/price',
            tokens: '/tokens'
        },
        rateLimit: { calls: 600, window: 60000 }
    },

    BIRDEYE: {
        baseUrl: 'https://public-api.birdeye.so',
        endpoints: {
            tokenPrice: '/defi/price',
            tokenPriceMulti: '/defi/multi_price',
            tokenOverview: '/defi/token_overview',
            tokenSecurity: '/defi/token_security',
            ohlcv: '/defi/ohlcv',
            trades: '/defi/txs/token',
            trendingTokens: '/defi/token_trending'
        },
        rateLimit: { calls: 100, window: 60000 }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 🛠️ MIDDLEWARE & DATA INDEXING (THE GRAPH)
    // ─────────────────────────────────────────────────────────────────────────
    THEGRAPH: {
        decentralizedEndpoint: 'https://gateway.thegraph.com/api/{api_key}/subgraphs/id/',
        hostedEndpoint: 'https://api.thegraph.com/subgraphs/name/',
        
        // Key subgraphs for DeFi analytics
        subgraphs: {
            // Ethereum Mainnet
            uniswapV3: {
                id: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
                hosted: 'uniswap/uniswap-v3'
            },
            aaveV3: {
                id: 'GQFbb95cE6d8mV989mL5figjaGaKCQB3xqYrr1bRyXqF',
                hosted: 'aave/protocol-v3'
            },
            curve: {
                id: '4yx4rR1qVNxrPxZWjSUmKcPaAzjkWzWWoFqyNdqnKqQN',
                hosted: 'curvefi/curve'
            },
            compound: {
                id: '7wKyNzDU4WfUEMzEfyqYL9GYBWjj5CX8BvJsSkWxkKB1',
                hosted: 'graphprotocol/compound-v2'
            },
            balancer: {
                id: 'GAWNgiGrA9eRce5gha9tWc7q5DPvN3fs5rSJ6tEULFNM',
                hosted: 'balancer-labs/balancer-v2'
            },
            lido: {
                id: 'HXfMc1jPHfFQoccWd7VMv66km75FoxVEfc7L9MFH9hcz',
                hosted: 'lidofinance/lido'
            },
            maker: {
                hosted: 'protofire/maker-protocol'
            },
            sushiswap: {
                hosted: 'sushiswap/exchange'
            },
            
            // L2 Subgraphs
            arbitrumUniswap: {
                id: 'FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM',
                hosted: 'ianlapham/uniswap-v3-arbitrum'
            },
            optimismUniswap: {
                id: 'Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj',
                hosted: 'ianlapham/optimism-uniswap-v3'
            },
            baseAerodrome: {
                id: 'GYsLKVxPXLRR5PMv2MH3eLxJGw6ZCFhdJq3EwCcYZMz5',
                hosted: 'aerodrome-finance/aerodrome'
            }
        }
    }
};


// ═══════════════════════════════════════════════════════════════════════════
//                         MAIN DATA FETCHER CLASS
// ═══════════════════════════════════════════════════════════════════════════

class MultiSourceDataFetcher {
    constructor(apiKeys = {}) {
        this.apiKeys = {
            dune: apiKeys.dune || process.env.DUNE_API_KEY || '',
            flipside: apiKeys.flipside || process.env.FLIPSIDE_API_KEY || '',
            glassnode: apiKeys.glassnode || process.env.GLASSNODE_API_KEY || '',
            intotheblock: apiKeys.intotheblock || process.env.ITB_API_KEY || '',
            etherscan: apiKeys.etherscan || process.env.ETHERSCAN_API_KEY || '',
            thegraph: apiKeys.thegraph || process.env.THEGRAPH_API_KEY || '',
            birdeye: apiKeys.birdeye || process.env.BIRDEYE_API_KEY || '',
            dappradar: apiKeys.dappradar || process.env.DAPPRADAR_API_KEY || ''
        };
        
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes default
        this.rateLimitTrackers = {};
    }

    // ─────────────────────────────────────────────────────────────────────────
    //                           UTILITY METHODS
    // ─────────────────────────────────────────────────────────────────────────

    async fetchWithRetry(url, options = {}, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    }
                });
                
                if (response.status === 429) {
                    // Rate limited - wait and retry
                    const retryAfter = response.headers.get('Retry-After') || (i + 1) * 2;
                    await this.sleep(retryAfter * 1000);
                    continue;
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return await response.json();
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await this.sleep((i + 1) * 1000);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    setCache(key, data, customExpiry = null) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            expiry: customExpiry || this.cacheExpiry
        });
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🔍 DUNE ANALYTICS METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Execute a Dune query and wait for results
     * @param {string} queryId - Dune query ID
     * @param {object} params - Query parameters
     */
    async executeDuneQuery(queryId, params = {}) {
        const cacheKey = `dune:${queryId}:${JSON.stringify(params)}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        if (!this.apiKeys.dune) {
            console.warn('Dune API key not set. Using cached/public data.');
            return null;
        }

        try {
            // Execute query
            const executeResponse = await this.fetchWithRetry(
                `${API_ENDPOINTS.DUNE.baseUrl}/query/${queryId}/execute`,
                {
                    method: 'POST',
                    headers: { 'X-Dune-API-Key': this.apiKeys.dune },
                    body: JSON.stringify({ query_parameters: params })
                }
            );

            const executionId = executeResponse.execution_id;

            // Poll for results
            let results = null;
            for (let i = 0; i < 30; i++) {
                await this.sleep(2000);
                
                const statusResponse = await this.fetchWithRetry(
                    `${API_ENDPOINTS.DUNE.baseUrl}/execution/${executionId}/results`,
                    { headers: { 'X-Dune-API-Key': this.apiKeys.dune } }
                );

                if (statusResponse.state === 'QUERY_STATE_COMPLETED') {
                    results = statusResponse.result;
                    break;
                } else if (statusResponse.state === 'QUERY_STATE_FAILED') {
                    throw new Error('Dune query failed');
                }
            }

            this.setCache(cacheKey, results, 10 * 60 * 1000); // 10 min cache for Dune
            return results;

        } catch (error) {
            console.error(`Dune query ${queryId} failed:`, error.message);
            return null;
        }
    }

    /**
     * Get latest results from a Dune query (no execution, faster)
     */
    async getDuneQueryResults(queryId) {
        const cacheKey = `dune:latest:${queryId}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        if (!this.apiKeys.dune) return null;

        try {
            const response = await this.fetchWithRetry(
                `${API_ENDPOINTS.DUNE.baseUrl}/query/${queryId}/results`,
                { headers: { 'X-Dune-API-Key': this.apiKeys.dune } }
            );

            this.setCache(cacheKey, response.result);
            return response.result;

        } catch (error) {
            console.error(`Dune results fetch failed:`, error.message);
            return null;
        }
    }

    /**
     * Pre-built Dune queries for common analytics
     */
    async getDuneWhaleActivity(chain = 'ethereum') {
        return this.getDuneQueryResults(API_ENDPOINTS.DUNE.publicQueries.ethWhaleWallets);
    }

    async getDuneDeFiTVL() {
        return this.getDuneQueryResults(API_ENDPOINTS.DUNE.publicQueries.defiTvlByChain);
    }

    async getDuneDEXVolumes() {
        return this.getDuneQueryResults(API_ENDPOINTS.DUNE.publicQueries.dexVolumeAggregated);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    📊 DEFILLAMA METHODS (FREE - NO KEY NEEDED)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get all protocols with TVL data
     */
    async getDefiLlamaProtocols() {
        const cacheKey = 'defillama:protocols';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.protocols);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama protocols fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Get detailed protocol data
     */
    async getDefiLlamaProtocol(protocolSlug) {
        const cacheKey = `defillama:protocol:${protocolSlug}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.DEFILLAMA.baseUrl}/protocol/${protocolSlug}`
            );
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error(`DefiLlama protocol ${protocolSlug} fetch failed:`, error.message);
            return null;
        }
    }

    /**
     * Get TVL history for all chains
     */
    async getDefiLlamaTVLHistory() {
        const cacheKey = 'defillama:tvlHistory';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.tvlHistory);
            this.setCache(cacheKey, data, 30 * 60 * 1000); // 30 min cache
            return data;
        } catch (error) {
            console.error('DefiLlama TVL history fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Get all yield pools
     */
    async getDefiLlamaYields() {
        const cacheKey = 'defillama:yields';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.yields);
            this.setCache(cacheKey, data?.data || []);
            return data?.data || [];
        } catch (error) {
            console.error('DefiLlama yields fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Get stablecoin data
     */
    async getDefiLlamaStablecoins() {
        const cacheKey = 'defillama:stablecoins';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.stablecoins);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama stablecoins fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get DEX volumes overview
     */
    async getDefiLlamaDEXVolumes() {
        const cacheKey = 'defillama:dexVolumes';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.dexVolumes);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama DEX volumes fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get fees and revenue data
     */
    async getDefiLlamaFees() {
        const cacheKey = 'defillama:fees';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.fees);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama fees fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get derivatives/perps data
     */
    async getDefiLlamaDerivatives() {
        const cacheKey = 'defillama:derivatives';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.derivatives);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama derivatives fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get bridge volumes
     */
    async getDefiLlamaBridges() {
        const cacheKey = 'defillama:bridges';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.bridges);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama bridges fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get token unlocks data
     */
    async getDefiLlamaUnlocks() {
        const cacheKey = 'defillama:unlocks';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.unlocks);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama unlocks fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get fundraising data
     */
    async getDefiLlamaRaises() {
        const cacheKey = 'defillama:raises';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(API_ENDPOINTS.DEFILLAMA.endpoints.raises);
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('DefiLlama raises fetch failed:', error.message);
            return null;
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🧩 GLASSNODE METHODS (FREE TIER)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Fetch Glassnode metric
     */
    async getGlassnodeMetric(metric, asset = 'BTC', params = {}) {
        const cacheKey = `glassnode:${metric}:${asset}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        if (!this.apiKeys.glassnode) {
            console.warn('Glassnode API key not set');
            return null;
        }

        try {
            const url = new URL(`${API_ENDPOINTS.GLASSNODE.baseUrl}/metrics/${metric}`);
            url.searchParams.set('a', asset);
            url.searchParams.set('api_key', this.apiKeys.glassnode);
            
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.set(key, value);
            });

            const data = await this.fetchWithRetry(url.toString());
            this.setCache(cacheKey, data, 15 * 60 * 1000); // 15 min cache
            return data;

        } catch (error) {
            console.error(`Glassnode ${metric} fetch failed:`, error.message);
            return null;
        }
    }

    async getGlassnodeActiveAddresses(asset = 'BTC') {
        return this.getGlassnodeMetric('addresses/active_count', asset);
    }

    async getGlassnodeExchangeBalance(asset = 'BTC') {
        return this.getGlassnodeMetric('distribution/balance_exchanges', asset);
    }

    async getGlassnodeExchangeNetflow(asset = 'BTC') {
        return this.getGlassnodeMetric('transactions/transfers_net_exchange_count', asset);
    }

    async getGlassnodeNUPL(asset = 'BTC') {
        return this.getGlassnodeMetric('indicators/net_unrealized_profit_loss', asset);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    📈 DEXSCREENER METHODS (FREE)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Search for token pairs
     */
    async searchDexScreener(query) {
        const cacheKey = `dexscreener:search:${query}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.DEXSCREENER.baseUrl}/latest/dex/search?q=${encodeURIComponent(query)}`
            );
            this.setCache(cacheKey, data, 2 * 60 * 1000); // 2 min cache for search
            return data;
        } catch (error) {
            console.error('DexScreener search failed:', error.message);
            return null;
        }
    }

    /**
     * Get pair data by chain and address
     */
    async getDexScreenerPairs(chain, pairAddresses) {
        const addresses = Array.isArray(pairAddresses) ? pairAddresses.join(',') : pairAddresses;
        const cacheKey = `dexscreener:pairs:${chain}:${addresses}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.DEXSCREENER.baseUrl}/latest/dex/pairs/${chain}/${addresses}`
            );
            this.setCache(cacheKey, data, 60 * 1000); // 1 min cache
            return data;
        } catch (error) {
            console.error('DexScreener pairs fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get token data by addresses
     */
    async getDexScreenerTokens(tokenAddresses) {
        const addresses = Array.isArray(tokenAddresses) ? tokenAddresses.join(',') : tokenAddresses;
        const cacheKey = `dexscreener:tokens:${addresses}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.DEXSCREENER.baseUrl}/latest/dex/tokens/${addresses}`
            );
            this.setCache(cacheKey, data, 60 * 1000);
            return data;
        } catch (error) {
            console.error('DexScreener tokens fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get trending/boosted tokens
     */
    async getDexScreenerTrending() {
        const cacheKey = 'dexscreener:trending';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.DEXSCREENER.baseUrl}/token-boosts/top/v1`
            );
            this.setCache(cacheKey, data, 5 * 60 * 1000);
            return data;
        } catch (error) {
            console.error('DexScreener trending fetch failed:', error.message);
            return null;
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🔗 ETHERSCAN / BLOCK EXPLORER METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get transactions for an address
     */
    async getEtherscanTxList(address, chain = 'ethereum') {
        const cacheKey = `etherscan:txlist:${chain}:${address}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        const baseUrl = API_ENDPOINTS.ETHERSCAN.l2Variants[chain] || API_ENDPOINTS.ETHERSCAN.baseUrl;
        
        try {
            const url = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${this.apiKeys.etherscan || ''}`;
            const data = await this.fetchWithRetry(url);
            
            if (data.status === '1') {
                this.setCache(cacheKey, data.result, 5 * 60 * 1000);
                return data.result;
            }
            return [];
        } catch (error) {
            console.error('Etherscan txlist fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Get token transfers for an address
     */
    async getEtherscanTokenTx(address, chain = 'ethereum') {
        const cacheKey = `etherscan:tokentx:${chain}:${address}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        const baseUrl = API_ENDPOINTS.ETHERSCAN.l2Variants[chain] || API_ENDPOINTS.ETHERSCAN.baseUrl;
        
        try {
            const url = `${baseUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${this.apiKeys.etherscan || ''}`;
            const data = await this.fetchWithRetry(url);
            
            if (data.status === '1') {
                this.setCache(cacheKey, data.result, 5 * 60 * 1000);
                return data.result;
            }
            return [];
        } catch (error) {
            console.error('Etherscan tokentx fetch failed:', error.message);
            return [];
        }
    }

    /**
     * Get current gas prices
     */
    async getEtherscanGas() {
        const cacheKey = 'etherscan:gas';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const url = `${API_ENDPOINTS.ETHERSCAN.baseUrl}?module=gastracker&action=gasoracle&apikey=${this.apiKeys.etherscan || ''}`;
            const data = await this.fetchWithRetry(url);
            
            if (data.status === '1') {
                this.setCache(cacheKey, data.result, 30 * 1000); // 30 sec cache
                return data.result;
            }
            return null;
        } catch (error) {
            console.error('Etherscan gas fetch failed:', error.message);
            return null;
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🟣 SOLSCAN METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get Solana account info
     */
    async getSolscanAccount(address) {
        const cacheKey = `solscan:account:${address}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.SOLSCAN.baseUrl}/account/${address}`
            );
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Solscan account fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Get token info from Solscan
     */
    async getSolscanToken(tokenAddress) {
        const cacheKey = `solscan:token:${tokenAddress}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchWithRetry(
                `${API_ENDPOINTS.SOLSCAN.baseUrl}/token/meta?tokenAddress=${tokenAddress}`
            );
            this.setCache(cacheKey, data);
            return data;
        } catch (error) {
            console.error('Solscan token fetch failed:', error.message);
            return null;
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🛠️ THE GRAPH (SUBGRAPH) METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Query a subgraph
     */
    async querySubgraph(subgraphId, query, variables = {}) {
        const cacheKey = `thegraph:${subgraphId}:${JSON.stringify({ query, variables })}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            let endpoint;
            if (this.apiKeys.thegraph) {
                endpoint = `${API_ENDPOINTS.THEGRAPH.decentralizedEndpoint.replace('{api_key}', this.apiKeys.thegraph)}${subgraphId}`;
            } else {
                // Fall back to hosted service
                const subgraph = Object.values(API_ENDPOINTS.THEGRAPH.subgraphs).find(s => s.id === subgraphId);
                if (subgraph?.hosted) {
                    endpoint = `${API_ENDPOINTS.THEGRAPH.hostedEndpoint}${subgraph.hosted}`;
                } else {
                    throw new Error('Subgraph not found and no API key');
                }
            }

            const data = await this.fetchWithRetry(endpoint, {
                method: 'POST',
                body: JSON.stringify({ query, variables })
            });

            this.setCache(cacheKey, data?.data, 5 * 60 * 1000);
            return data?.data;

        } catch (error) {
            console.error('Subgraph query failed:', error.message);
            return null;
        }
    }

    /**
     * Get Uniswap V3 pool data
     */
    async getUniswapPools(first = 100, orderBy = 'totalValueLockedUSD') {
        const query = `
            query GetPools($first: Int!, $orderBy: String!) {
                pools(first: $first, orderBy: $orderBy, orderDirection: desc) {
                    id
                    token0 { symbol name }
                    token1 { symbol name }
                    feeTier
                    liquidity
                    sqrtPrice
                    tick
                    totalValueLockedUSD
                    totalValueLockedToken0
                    totalValueLockedToken1
                    volumeUSD
                    txCount
                }
            }
        `;
        return this.querySubgraph(
            API_ENDPOINTS.THEGRAPH.subgraphs.uniswapV3.id,
            query,
            { first, orderBy }
        );
    }

    /**
     * Get Aave V3 market data
     */
    async getAaveMarkets() {
        const query = `
            query GetMarkets {
                markets(first: 50, orderBy: totalValueLockedUSD, orderDirection: desc) {
                    id
                    name
                    inputToken { symbol }
                    totalValueLockedUSD
                    totalBorrowBalanceUSD
                    totalDepositBalanceUSD
                    rates {
                        rate
                        type
                    }
                }
            }
        `;
        return this.querySubgraph(
            API_ENDPOINTS.THEGRAPH.subgraphs.aaveV3.id,
            query
        );
    }

    /**
     * Get Curve pool data
     */
    async getCurvePools() {
        const query = `
            query GetPools {
                pools(first: 50, orderBy: totalValueLockedUSD, orderDirection: desc) {
                    id
                    name
                    symbol
                    coins
                    totalValueLockedUSD
                    cumulativeVolumeUSD
                }
            }
        `;
        return this.querySubgraph(
            API_ENDPOINTS.THEGRAPH.subgraphs.curve.id,
            query
        );
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //                    🎯 AGGREGATED DATA METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get comprehensive market overview from multiple sources
     */
    async getMarketOverview() {
        const [
            defiLlamaProtocols,
            defiLlamaTvl,
            defiLlamaFees,
            defiLlamaDex,
            defiLlamaStables,
            dexscreenerTrending
        ] = await Promise.all([
            this.getDefiLlamaProtocols(),
            this.getDefiLlamaTVLHistory(),
            this.getDefiLlamaFees(),
            this.getDefiLlamaDEXVolumes(),
            this.getDefiLlamaStablecoins(),
            this.getDexScreenerTrending()
        ]);

        // Calculate metrics
        const totalTvl = defiLlamaProtocols.reduce((sum, p) => sum + (p.tvl || 0), 0);
        const top10ByTvl = defiLlamaProtocols.slice(0, 10);
        const tvlByChain = this.aggregateTvlByChain(defiLlamaProtocols);

        return {
            timestamp: Date.now(),
            summary: {
                totalTvl,
                totalProtocols: defiLlamaProtocols.length,
                tvlByChain,
                top10ByTvl: top10ByTvl.map(p => ({ name: p.name, tvl: p.tvl, chain: p.chain }))
            },
            fees: defiLlamaFees,
            dexVolumes: defiLlamaDex,
            stablecoins: defiLlamaStables,
            trending: dexscreenerTrending
        };
    }

    /**
     * Get protocol deep dive with multi-source data
     */
    async getProtocolDeepDive(protocolSlug) {
        const [
            defiLlamaData,
            defiLlamaYields,
            defiLlamaFees
        ] = await Promise.all([
            this.getDefiLlamaProtocol(protocolSlug),
            this.getDefiLlamaYields(),
            this.getDefiLlamaFees()
        ]);

        if (!defiLlamaData) return null;

        // Filter yields for this protocol
        const protocolYields = defiLlamaYields.filter(
            y => y.project?.toLowerCase() === protocolSlug.toLowerCase()
        );

        // Get fee data for this protocol
        const protocolFees = defiLlamaFees?.protocols?.find(
            p => p.name?.toLowerCase() === defiLlamaData.name?.toLowerCase()
        );

        return {
            basic: {
                name: defiLlamaData.name,
                symbol: defiLlamaData.symbol,
                tvl: defiLlamaData.tvl,
                category: defiLlamaData.category,
                chains: defiLlamaData.chains,
                url: defiLlamaData.url
            },
            tvlHistory: defiLlamaData.tvl,
            chainTvls: defiLlamaData.chainTvls,
            yields: protocolYields.slice(0, 10),
            fees: protocolFees,
            metrics: {
                tvlChange24h: defiLlamaData.change_1d,
                tvlChange7d: defiLlamaData.change_7d,
                tvlChange30d: defiLlamaData.change_1m
            }
        };
    }

    /**
     * Get token analytics from DexScreener + DefiLlama
     */
    async getTokenAnalytics(tokenSymbol) {
        const [dexScreenerData, defiLlamaYields] = await Promise.all([
            this.searchDexScreener(tokenSymbol),
            this.getDefiLlamaYields()
        ]);

        const pairs = dexScreenerData?.pairs || [];
        const relevantYields = defiLlamaYields.filter(
            y => y.symbol?.toUpperCase().includes(tokenSymbol.toUpperCase())
        );

        // Aggregate data across DEXes
        const aggregatedVolume = pairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0);
        const avgPriceUsd = pairs.length > 0 
            ? pairs.reduce((sum, p) => sum + (p.priceUsd || 0), 0) / pairs.length 
            : 0;

        return {
            symbol: tokenSymbol,
            priceUsd: avgPriceUsd,
            volume24h: aggregatedVolume,
            topPairs: pairs.slice(0, 10).map(p => ({
                dex: p.dexId,
                chain: p.chainId,
                baseToken: p.baseToken?.symbol,
                quoteToken: p.quoteToken?.symbol,
                priceUsd: p.priceUsd,
                volume24h: p.volume?.h24,
                liquidity: p.liquidity?.usd
            })),
            yieldOpportunities: relevantYields.slice(0, 5).map(y => ({
                protocol: y.project,
                pool: y.symbol,
                apy: y.apy,
                tvl: y.tvlUsd
            }))
        };
    }

    /**
     * Get on-chain health signals
     */
    async getOnchainHealth(asset = 'ETH') {
        const glassAsset = asset === 'ETH' ? 'ETH' : asset;
        
        const [activeAddresses, exchangeBalance, nupl] = await Promise.all([
            this.getGlassnodeActiveAddresses(glassAsset),
            this.getGlassnodeExchangeBalance(glassAsset),
            this.getGlassnodeNUPL(glassAsset)
        ]);

        return {
            asset,
            timestamp: Date.now(),
            activeAddresses: {
                current: activeAddresses?.[activeAddresses?.length - 1]?.v,
                data: activeAddresses?.slice(-30) // Last 30 data points
            },
            exchangeBalance: {
                current: exchangeBalance?.[exchangeBalance?.length - 1]?.v,
                data: exchangeBalance?.slice(-30)
            },
            nupl: {
                current: nupl?.[nupl?.length - 1]?.v,
                data: nupl?.slice(-30)
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    //                           HELPER METHODS
    // ─────────────────────────────────────────────────────────────────────────

    aggregateTvlByChain(protocols) {
        const chainTvl = {};
        for (const protocol of protocols) {
            if (protocol.chainTvls) {
                for (const [chain, tvl] of Object.entries(protocol.chainTvls)) {
                    if (typeof tvl === 'number') {
                        chainTvl[chain] = (chainTvl[chain] || 0) + tvl;
                    }
                }
            }
        }
        return Object.entries(chainTvl)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20)
            .reduce((obj, [chain, tvl]) => {
                obj[chain] = tvl;
                return obj;
            }, {});
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//                              EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

const multiSourceFetcher = new MultiSourceDataFetcher();

module.exports = {
    MultiSourceDataFetcher,
    multiSourceFetcher,
    API_ENDPOINTS
};
