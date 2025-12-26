/**
 * Data source adapters for Nexxore agents
 * Unified interface for news, prices, sentiment, on-chain data
 */

const { fetchWithTimeout, retryAsync, AgentLogger } = require('./utils');

const logger = new AgentLogger('DataSources');

/**
 * News Data Source
 * Aggregates from CoinDesk, CoinTelegraph, RSS feeds
 */
class NewsSource {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 min
  }
  
  async fetchNews(keywords = [], limit = 10) {
    const cacheKey = `news_${keywords.join('_')}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      // Placeholder: In production, call actual news APIs
      // - CoinDesk API
      // - CoinTelegraph RSS
      // - Messari API
      const articles = await this.fetchNewsFromAPIs(keywords, limit);
      
      const normalized = articles.map(article => ({
        source: article.source,
        title: article.title,
        summary: article.summary,
        url: article.url,
        sentiment: article.sentiment || 0, // -1 to +1
        protocols: article.protocols || [],
        timestamp: article.timestamp,
        relevanceScore: this.calculateRelevance(article, keywords)
      }));
      
      this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
      return normalized;
    } catch (err) {
      logger.error('Failed to fetch news', { keywords, error: err.message });
      return [];
    }
  }
  
  async fetchNewsFromAPIs(keywords, limit) {
    // Replace with actual API calls
    return [];
  }
  
  calculateRelevance(article, keywords) {
    let score = 0;
    const text = `${article.title} ${article.summary}`.toLowerCase();
    
    keywords.forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        score += 1;
      }
    });
    
    return Math.min(score / keywords.length, 1);
  }
}

/**
 * Price & Market Data Source
 * Integrates CoinGecko, CoinMarketCap
 */
class PriceSource {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheTTL = 60 * 1000; // 1 min
  }
  
  async fetchTokenData(tokenIds = []) {
    const cacheKey = `prices_${tokenIds.join('_')}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      // Placeholder: Call CoinGecko API
      // https://api.coingecko.com/api/v3/simple/price?ids=aave,curve-dao-token&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true
      const data = await this.fetchFromCoinGecko(tokenIds);
      
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (err) {
      logger.error('Failed to fetch price data', { tokenIds, error: err.message });
      return {};
    }
  }
  
  async fetchFromCoinGecko(tokenIds) {
    // Implement actual call
    return {};
  }
  
  async calculateMetrics(tokenId) {
    const data = await this.fetchTokenData([tokenId]);
    return {
      price: data[tokenId]?.usd,
      marketCap: data[tokenId]?.usd_market_cap,
      volume24h: data[tokenId]?.usd_24h_vol,
      changePercent24h: data[tokenId]?.usd_24h_change
    };
  }
}

/**
 * DeFi Metrics Source
 * TVL, APY, yields from DeFiLlama
 */
class DeFiSource {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.baseUrl = 'https://api.llama.fi';
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 min
  }
  
  async fetchProtocolData(protocolName) {
    const cacheKey = `defi_${protocolName}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const url = `${this.baseUrl}/protocol/${protocolName}`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      
      // Extract TVL history array
      const tvlHistory = Array.isArray(data.tvl) ? data.tvl : [];
      
      // Get current TVL from last entry in history
      const latestTvl = tvlHistory.length > 0 ? tvlHistory[tvlHistory.length - 1] : null;
      const currentTvl = latestTvl ? (latestTvl.totalLiquidityUSD || 0) : 0;
      
      const normalized = {
        protocol: protocolName,
        tvl: currentTvl,
        tvlChain: data.chainTvls || data.currentChainTvls,
        description: data.description || '',
        url: data.url || '',
        metrics: {
          tvlChange7d: tvlHistory.length >= 8 ? this.calculateChange(currentTvl, tvlHistory) : 0,
          yield: data.apy || data.apyBase || 0
        },
        timestamp: Date.now()
      };
      
      this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
      return normalized;
    } catch (err) {
      logger.error('Failed to fetch DeFi data', { protocol: protocolName, error: err.message });
      return null;
    }
  }
  
  calculateChange(current, history) {
    if (!history || history.length < 8) return 0;
    const weekAgo = history[history.length - 8];
    const previous = weekAgo.totalLiquidityUSD || weekAgo.tvl || weekAgo;
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }
}

/**
 * Sentiment Analysis Source
 * X/Twitter sentiment, Discord activity
 */
class SentimentSource {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheTTL = 15 * 60 * 1000; // 15 min
  }
  
  async analyzeSentiment(keywords = [], platforms = ['twitter']) {
    const cacheKey = `sentiment_${keywords.join('_')}_${platforms.join('_')}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    try {
      const sentiment = {
        score: 0, // -1 to +1
        category: 'neutral',
        mentionCount: 0,
        platforms: {},
        timestamp: Date.now()
      };
      
      // Placeholder: Integrate X API, sentiment models
      // - Fetch recent tweets
      // - Apply VADER/FinBERT
      // - Aggregate scores
      
      this.cache.set(cacheKey, { data: sentiment, timestamp: Date.now() });
      return sentiment;
    } catch (err) {
      logger.error('Failed to analyze sentiment', { keywords, error: err.message });
      return { score: 0, category: 'neutral', mentionCount: 0 };
    }
  }
}

/**
 * On-chain Data Source
 * Whale transactions, swap volume, liquidity flows
 */
class OnChainSource {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 min
  }
  
  async fetchWhaleTransactions(address, limit = 10) {
    // Integrate with Etherscan/Solscan APIs
    try {
      const txs = await this.fetchFromExplorer(address, limit);
      return txs;
    } catch (err) {
      logger.error('Failed to fetch whale txs', { address, error: err.message });
      return [];
    }
  }
  
  async fetchFromExplorer(address, limit) {
    // Placeholder
    return [];
  }
  
  async fetchLiquidityFlow(token) {
    // Analyze DEX swap volume, liquidity changes
    return {
      token,
      inflow24h: 0,
      outflow24h: 0,
      netFlow: 0
    };
  }
}

/**
 * Unified Data Fetcher
 */
class DataFetcher {
  constructor(apiKeys = {}) {
    this.news = new NewsSource(apiKeys);
    this.prices = new PriceSource(apiKeys);
    this.defi = new DeFiSource(apiKeys);
    this.sentiment = new SentimentSource(apiKeys);
    this.onchain = new OnChainSource(apiKeys);
  }
  
  async fetchProtocolContext(protocolName, lookbackHours = 24) {
    const [protocolData, priceData, sentimentData] = await Promise.all([
      this.defi.fetchProtocolData(protocolName),
      this.prices.fetchTokenData([protocolName.toLowerCase()]),
      this.sentiment.analyzeSentiment([protocolName])
    ]);
    
    return {
      protocol: protocolName,
      defi: protocolData,
      price: priceData,
      sentiment: sentimentData,
      timestamp: Date.now()
    };
  }
}

module.exports = {
  NewsSource,
  PriceSource,
  DeFiSource,
  SentimentSource,
  OnChainSource,
  DataFetcher
};
