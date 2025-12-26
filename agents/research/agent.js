/**
 * Research Agent
 * 
 * Detects alpha opportunities by analyzing:
 * - News sentiment & narrative momentum
 * - Protocol metrics (TVL, APY, growth)
 * - Social signals (X/Twitter, Discord)
 * - On-chain activity (whale trades, liquidity flows)
 */

const { DataFetcher } = require('../shared/dataSources');
const {
  generateInsightId,
  calculateConfidence,
  formatInsight,
  AgentLogger,
  categorizeSentiment
} = require('../shared/utils');

class ResearchAgent {
  constructor(config = {}) {
    this.name = 'ResearchAgent';
    this.logger = new AgentLogger(this.name);
    this.config = {
      minConfidence: 0.2,
      maxResults: 10,
      lookbackHours: 24,
      ...config
    };
    
    this.dataFetcher = new DataFetcher(config.apiKeys || {});
    this.insights = [];
  }
  
  /**
   * Main analysis method
   * Input: { protocol?, keywords?, lookbackHours? }
   * Output: { insights, summary, timestamp }
   */
  async analyze(context = {}) {
    const startTime = Date.now();
    
    this.logger.debug('Starting analysis', { context });
    
    try {
      const protocol = context.protocol || null;
      const keywords = context.keywords && context.keywords.length > 0 
        ? context.keywords 
        : (protocol ? [protocol] : []);
      const lookbackHours = context.lookbackHours || this.config.lookbackHours;
      
      this.logger.debug('Processed context', { protocol, keywords, lookbackHours });
      
      // Fetch data from all sources
      const signals = await this.gatherSignals(keywords, lookbackHours);
      
      // Score and rank opportunities
      const insights = this.scoreInsights(signals, protocol);
      
      // Generate summaries
      const summary = this.generateSummary(insights);
      
      const result = {
        type: 'research_analysis',
        insights: insights.slice(0, this.config.maxResults),
        summary,
        signalsAnalyzed: signals.length,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        confidence: insights[0]?.confidence || 0
      };
      
      this.logger.info('Analysis complete', { insightCount: insights.length });
      return result;
    } catch (err) {
      this.logger.error('Analysis failed', { error: err.message });
      return {
        type: 'research_analysis',
        insights: [],
        summary: 'Analysis failed',
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Gather signals from all data sources
   */
  async gatherSignals(keywords, lookbackHours) {
    const signals = [];
    
    try {
      // Fetch news
      const newsArticles = await this.dataFetcher.news.fetchNews(keywords);
      signals.push(...newsArticles.map(article => ({
        type: 'news',
        source: article.source,
        title: article.title,
        sentiment: article.sentiment,
        relevance: article.relevanceScore,
        protocol: keywords[0] || 'unknown',
        weight: 0.25
      })));
      
      // Fetch sentiment
      const sentiment = await this.dataFetcher.sentiment.analyzeSentiment(keywords);
      signals.push({
        type: 'social_sentiment',
        score: sentiment.score,
        mentionCount: sentiment.mentionCount,
        category: categorizeSentiment(sentiment.score),
        protocol: keywords[0] || 'unknown',
        weight: 0.20
      });
      
      // Fetch DeFi metrics (for each keyword that's a protocol)
      for (const keyword of keywords) {
        try {
          const defiData = await this.dataFetcher.defi.fetchProtocolData(keyword);
          if (defiData) {
            signals.push({
              type: 'defi_metrics',
              protocol: keyword,
              tvl: defiData.tvl,
              tvlChange7d: defiData.metrics.tvlChange7d,
              yield: defiData.metrics.yield,
              weight: 0.30
            });
          }
        } catch (e) {
          this.logger.debug('Could not fetch DeFi data', { keyword });
        }
      }
      
      // Fetch price changes
      const prices = await this.dataFetcher.prices.fetchTokenData(keywords.map(k => k.toLowerCase()));
      for (const [token, data] of Object.entries(prices)) {
        if (data) {
          signals.push({
            type: 'price_momentum',
            token,
            protocol: token,
            changePercent24h: data.usd_24h_change,
            volume24h: data.usd_24h_vol,
            weight: 0.15
          });
        }
      }
      
      this.logger.debug('Signals gathered', { count: signals.length });
    } catch (err) {
      this.logger.warn('Error gathering signals', { error: err.message });
    }
    
    return signals;
  }
  
  /**
   * Score and rank insights
   */
  scoreInsights(signals, protocol) {
    const grouped = this.groupSignalsByProtocol(signals);
    
    const insights = Array.from(grouped.entries()).map(([name, sigs]) => {
      const newsSignals = sigs.filter(s => s.type === 'news');
      const sentimentSignal = sigs.find(s => s.type === 'social_sentiment');
      const defiSignal = sigs.find(s => s.type === 'defi_metrics');
      const priceSignal = sigs.find(s => s.type === 'price_momentum');
      
      // Build insight
      const detail = {
        protocol: name,
        newsCount: newsSignals.length,
        sentiment: sentimentSignal?.score || 0,
        tvlGrowth: defiSignal?.tvlChange7d || 0,
        priceChange24h: priceSignal?.changePercent24h || 0
      };
      
      // Calculate confidence
      const tvlScore = detail.tvlGrowth !== 0 ? Math.min(Math.abs(detail.tvlGrowth) / 10, 1) : 0.1;
      const sentimentScore = sentimentSignal ? Math.abs(sentimentSignal.score || 0) : 0.1;
      const newsScore = newsSignals.length > 0 ? Math.min(newsSignals.length / 5, 1) : 0.1;
      const priceScore = detail.priceChange24h !== 0 ? Math.min(Math.abs(detail.priceChange24h) / 10, 1) : 0.1;
      
      const confidence = calculateConfidence([
        { score: sentimentScore, weight: 0.25 },
        { score: tvlScore, weight: 0.35 },
        { score: newsScore, weight: 0.2 },
        { score: priceScore, weight: 0.2 }
      ]);
      
      if (confidence < this.config.minConfidence) {
        this.logger.debug('Filtered low confidence insight', { protocol: name, confidence, minRequired: this.config.minConfidence });
        return null;
      }
      
      return {
        id: generateInsightId(),
        type: 'alpha_opportunity',
        protocol: name,
        confidence,
        signals: sigs.slice(0, 5),
        summary: this.generateProtocolSummary(detail, newsSignals),
        tags: this.generateTags(detail),
        timestamp: new Date().toISOString(),
        source: 'research_agent'
      };
    }).filter(Boolean);
    
    return insights.sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * Group signals by protocol
   */
  groupSignalsByProtocol(signals) {
    const grouped = new Map();
    
    signals.forEach(signal => {
      const key = signal.protocol || signal.token || 'unknown';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(signal);
    });
    
    return grouped;
  }
  
  /**
   * Generate human-readable summary
   */
  generateProtocolSummary(detail, newsSignals) {
    const parts = [];
    
    if (detail.tvlGrowth > 5) {
      parts.push(`Strong TVL growth (+${detail.tvlGrowth.toFixed(1)}%)`);
    }
    
    if (detail.sentiment > 0.3) {
      parts.push('Positive social sentiment');
    } else if (detail.sentiment < -0.3) {
      parts.push('Negative social sentiment');
    }
    
    if (newsSignals.length > 0) {
      parts.push(`${newsSignals.length} recent news items`);
    }
    
    if (detail.priceChange24h > 2) {
      parts.push(`Price momentum +${detail.priceChange24h.toFixed(2)}%`);
    }
    
    return parts.length > 0 
      ? `${detail.protocol}: ${parts.join('. ')}`
      : `${detail.protocol}: Monitor for emerging opportunities`;
  }
  
  /**
   * Generate tags for categorization
   */
  generateTags(detail) {
    const tags = [];
    
    if (detail.tvlGrowth > 10) tags.push('high_tvl_growth');
    if (detail.sentiment > 0.5) tags.push('bullish');
    if (detail.sentiment < -0.5) tags.push('bearish');
    if (detail.newsCount > 3) tags.push('news_spike');
    if (detail.priceChange24h > 5) tags.push('momentum');
    
    return tags;
  }
  
  /**
   * Generate overall summary
   */
  generateSummary(insights) {
    if (insights.length === 0) {
      return 'No significant opportunities detected.';
    }
    
    const topInsight = insights[0];
    const bullish = insights.filter(i => i.tags.includes('bullish')).length;
    const bearish = insights.filter(i => i.tags.includes('bearish')).length;
    
    return `Top opportunity: ${topInsight.protocol} (${(topInsight.confidence * 100).toFixed(0)}% confidence). ` +
           `${bullish} bullish, ${bearish} bearish signals detected.`;
  }
  
  /**
   * Get agent capabilities/metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: '1.0.0',
      type: 'research',
      capabilities: [
        'news_aggregation',
        'sentiment_analysis',
        'defi_metrics',
        'price_tracking',
        'opportunity_scoring'
      ],
      requiredData: ['news', 'prices', 'defi', 'sentiment'],
      outputFormat: 'insight',
      updateFrequency: '5-10 min'
    };
  }
}

module.exports = ResearchAgent;
