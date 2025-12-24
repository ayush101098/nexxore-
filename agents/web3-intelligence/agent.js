/**
 * Web3 Intelligence Agent
 * 
 * Aggregates Web3 ecosystem data:
 * - News & sentiment tracking
 * - Token information hub
 * - Market trends & liquidity
 * - Alpha opportunity scanner
 * - Community sentiment
 */

const { DataFetcher } = require('../shared/dataSources');
const RealNewsFetcher = require('../shared/newsFetcher');
const { AgentLogger, mergeInsights } = require('../shared/utils');

class Web3IntelligenceAgent {
  constructor(config = {}) {
    this.name = 'Web3IntelligenceAgent';
    this.logger = new AgentLogger(this.name);
    this.config = config;
    
    this.dataFetcher = new DataFetcher(config.apiKeys || {});
    this.newsFetcher = new RealNewsFetcher(config);
    this.trendCache = new Map();
  }
  
  /**
   * Comprehensive Web3 intelligence report
   */
  async generateReport(context = {}) {
    const startTime = Date.now();
    
    try {
      // Parallel data fetching
      const [news, trending, sentiment] = await Promise.all([
        this.fetchWeb3News(),
        this.fetchTrendingTokens(),
        this.analyzeCommunityPulse()
      ]);
      
      return {
        type: 'web3_intelligence_report',
        timestamp: new Date().toISOString(),
        sections: {
          news: this.processNewsSection(news),
          trending: this.processTrendingSection(trending),
          communityPulse: this.processSentimentSection(sentiment),
          alphaOpportunities: this.identifyAlpha(news, trending),
          marketTrends: this.analyzeTrends(news, trending)
        },
        summary: this.generateReportSummary(news, trending, sentiment),
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      this.logger.error('Report generation failed', { error: err.message });
      return {
        type: 'web3_intelligence_report',
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Fetch Web3-related news
   */
  async fetchWeb3News() {
    const keywords = [
      'crypto', 'defi', 'ethereum', 'bitcoin', 'blockchain',
      'nft', 'web3', 'layer2', 'solana', 'arbitrum',
      'yield', 'staking', 'ai agent', 'token launch', 'upgrade'
    ];
    
    try {
      const news = await this.newsFetcher.fetchCryptoNews(keywords, 30);
      return news;
    } catch (err) {
      this.logger.warn('News fetch failed', { error: err.message });
      return [];
    }
  }
  
  /**
   * Fetch trending tokens
   */
  async fetchTrendingTokens() {
    try {
      return await this.newsFetcher.fetchTrendingTokens();
    } catch (err) {
      this.logger.warn('Trending tokens fetch failed', { error: err.message });
      return [];
    }
  }
  
  /**
   * Analyze community sentiment
   */
  async analyzeCommunityPulse() {
    try {
      const sentiment = await this.dataFetcher.sentiment.analyzeSentiment(
        ['crypto', 'defi', 'web3', 'ethereum'],
        ['twitter']
      );
      return sentiment;
    } catch (err) {
      this.logger.warn('Sentiment analysis failed', { error: err.message });
      return { score: 0, category: 'neutral' };
    }
  }
  
  /**
   * Process news into sections
   */
  processNewsSection(news) {
    return {
      latestNews: news.slice(0, 10).map(article => ({
        title: article.title,
        source: article.source,
        sentiment: this.categorizeSentiment(article.sentiment),
        protocols: article.protocols,
        url: article.url,
        timestamp: article.timestamp
      })),
      topicDistribution: this.analyzeTopics(news),
      sentimentBreakdown: this.analyzeSentimentBreakdown(news)
    };
  }
  
  /**
   * Process trending section
   */
  processTrendingSection(tokens) {
    return {
      topTokens: tokens.slice(0, 10).map(token => ({
        symbol: token.symbol,
        name: token.name,
        rank: token.marketCapRank,
        gainersLosers: this.getGainersLosers(tokens)
      }))
    };
  }
  
  /**
   * Process sentiment section
   */
  processSentimentSection(sentiment) {
    return {
      overallSentiment: this.categorizeSentiment(sentiment.score),
      sentimentScore: sentiment.score,
      mentionVolume: sentiment.mentionCount,
      trendingNarratives: this.extractNarratives(),
      riskIndicators: this.identifyRisks(sentiment)
    };
  }
  
  /**
   * Identify alpha opportunities from news
   */
  identifyAlpha(news, tokens) {
    const alphas = [];
    
    // Look for new launches
    const launchNews = news.filter(n => 
      n.title.toLowerCase().includes('launch') ||
      n.title.toLowerCase().includes('debut') ||
      n.title.toLowerCase().includes('ido')
    );
    
    launchNews.slice(0, 3).forEach(item => {
      alphas.push({
        type: 'new_launch',
        headline: item.title,
        source: item.source,
        confidence: 'medium',
        action: 'research_further'
      });
    });
    
    // Look for partnerships
    const partnershipNews = news.filter(n =>
      n.title.toLowerCase().includes('partnership') ||
      n.title.toLowerCase().includes('integra')
    );
    
    partnershipNews.slice(0, 2).forEach(item => {
      alphas.push({
        type: 'partnership',
        headline: item.title,
        source: item.source,
        confidence: 'medium',
        action: 'monitor'
      });
    });
    
    // Look for protocol upgrades
    const upgradeNews = news.filter(n =>
      n.title.toLowerCase().includes('upgrade') ||
      n.title.toLowerCase().includes('launch') ||
      n.title.toLowerCase().includes('v4')
    );
    
    upgradeNews.slice(0, 2).forEach(item => {
      alphas.push({
        type: 'protocol_upgrade',
        headline: item.title,
        source: item.source,
        confidence: 'high',
        action: 'monitor'
      });
    });
    
    return alphas.slice(0, 5);
  }
  
  /**
   * Analyze market trends
   */
  analyzeTrends(news, tokens) {
    const trends = [];
    
    // Sector analysis
    const defiNews = news.filter(n => n.title.toLowerCase().includes('defi')).length;
    const nftNews = news.filter(n => n.title.toLowerCase().includes('nft')).length;
    const aiNews = news.filter(n => n.title.toLowerCase().includes('ai')).length;
    
    if (defiNews > 3) trends.push({ sector: 'DeFi', momentum: 'bullish', signals: defiNews });
    if (aiNews > 2) trends.push({ sector: 'AI-Web3', momentum: 'emerging', signals: aiNews });
    if (nftNews > 2) trends.push({ sector: 'NFT', momentum: 'neutral', signals: nftNews });
    
    return trends;
  }
  
  /**
   * Categorize sentiment
   */
  categorizeSentiment(score) {
    if (score > 0.5) return 'bullish';
    if (score > 0.1) return 'slightly_bullish';
    if (score > -0.1) return 'neutral';
    if (score > -0.5) return 'slightly_bearish';
    return 'bearish';
  }
  
  /**
   * Analyze topics in news
   */
  analyzeTopics(news) {
    const topics = {};
    
    news.forEach(article => {
      const title = article.title.toLowerCase();
      
      if (title.includes('defi')) topics.defi = (topics.defi || 0) + 1;
      if (title.includes('nft')) topics.nft = (topics.nft || 0) + 1;
      if (title.includes('layer 2') || title.includes('l2')) topics.layer2 = (topics.layer2 || 0) + 1;
      if (title.includes('ai') || title.includes('agent')) topics.ai = (topics.ai || 0) + 1;
      if (title.includes('staking')) topics.staking = (topics.staking || 0) + 1;
    });
    
    return topics;
  }
  
  /**
   * Analyze sentiment breakdown
   */
  analyzeSentimentBreakdown(news) {
    const bullish = news.filter(n => n.sentiment > 0.3).length;
    const bearish = news.filter(n => n.sentiment < -0.3).length;
    const neutral = news.length - bullish - bearish;
    
    return {
      bullish,
      bearish,
      neutral,
      bullishPercent: Math.round((bullish / news.length) * 100)
    };
  }
  
  /**
   * Get gainers/losers
   */
  getGainersLosers(tokens) {
    // Placeholder: would integrate real price data
    return {
      gainers: tokens.slice(0, 3).map(t => t.symbol),
      losers: tokens.slice(-3).reverse().map(t => t.symbol)
    };
  }
  
  /**
   * Extract narratives
   */
  extractNarratives() {
    return [
      'AI Integration in DeFi',
      'Layer 2 Expansion',
      'Stablecoin Competition',
      'Cross-Chain Solutions',
      'RWA Tokenization'
    ];
  }
  
  /**
   * Identify risks
   */
  identifyRisks(sentiment) {
    if (sentiment.score < -0.5) {
      return ['Bearish sentiment spike', 'Potential market downturn'];
    }
    if (sentiment.mentionCount > 10000) {
      return ['High volatility expected', 'Pump & dump risk'];
    }
    return ['Normal market conditions'];
  }
  
  /**
   * Generate report summary
   */
  generateReportSummary(news, tokens, sentiment) {
    const topNews = news[0]?.title || 'No major news';
    const topToken = tokens[0]?.symbol || 'N/A';
    const sentimentText = this.categorizeSentiment(sentiment.score);
    
    return `Web3 Pulse: ${topNews} | Top Token: ${topToken} | Sentiment: ${sentimentText}`;
  }
  
  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: '1.0.0',
      type: 'web3_intelligence',
      capabilities: [
        'news_aggregation',
        'sentiment_analysis',
        'token_tracking',
        'trend_detection',
        'alpha_identification',
        'community_pulse'
      ],
      dataSources: ['newsapi', 'coingecko', 'sentiment', 'onchain'],
      outputFormat: 'intelligence_report',
      updateFrequency: 'hourly'
    };
  }
}

module.exports = Web3IntelligenceAgent;
