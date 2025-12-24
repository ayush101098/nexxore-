/**
 * Advanced News Analyzer
 * 
 * Analyzes news articles to extract:
 * - Protocol impact assessment
 * - Sentiment trends
 * - Risk factors
 * - Opportunity signals
 */

const { AgentLogger } = require('./utils');

const logger = new AgentLogger('NewsAnalyzer');

class NewsAnalyzer {
  constructor() {
    this.protocolPatterns = {
      aave: /aave|lending protocol/i,
      curve: /curve|stablecoin swap/i,
      uniswap: /uniswap|dex|uni /i,
      lido: /lido|steth|eth staking/i,
      yearn: /yearn|vault|strategy/i,
      compound: /compound|lending|ctoken/i,
      maker: /maker|dai|cdp/i,
      balancer: /balancer|liquidity pool/i
    };
    
    this.riskKeywords = {
      high: ['exploit', 'hack', 'vulnerability', 'crash', 'collapse', 'liquidation cascade', 'emergency'],
      medium: ['risk', 'warning', 'concern', 'investigation', 'delay', 'outflow'],
      low: ['update', 'maintenance', 'announcement', 'improvement']
    };
    
    this.opportunityKeywords = {
      high: ['launch', 'partnership', 'integration', 'upgrade', 'ecosystem', 'yield'],
      medium: ['development', 'testing', 'proposal', 'research'],
      low: ['discussion', 'idea', 'concept']
    };
  }
  
  /**
   * Analyze a batch of news articles
   */
  analyzeNews(articles = []) {
    if (!articles || articles.length === 0) {
      return {
        total: 0,
        articles: [],
        summary: 'No articles to analyze',
        trends: { averageSentiment: 0, sentimentTrend: 'neutral', topProtocols: [], newsVelocity: 'low' },
        risks: [],
        opportunities: []
      };
    }

    return {
      total: articles.length,
      articles: articles.map(article => this.analyzeArticle(article)).slice(0, 20),
      summary: this.generateSummary(articles),
      trends: this.identifyTrends(articles),
      risks: this.identifyRisks(articles),
      opportunities: this.identifyOpportunities(articles)
    };
  }
  
  /**
   * Analyze single article
   */
  analyzeArticle(article) {
    const text = `${article.title} ${article.description || ''} ${article.summary || ''}`.toLowerCase();
    
    return {
      title: article.title,
      source: article.source,
      timestamp: article.timestamp || article.publishedAt,
      sentiment: this.analyzeSentiment(text),
      protocols: this.extractProtocols(text),
      riskLevel: this.assessRisk(text),
      opportunityLevel: this.assessOpportunity(text),
      impact: this.assessImpact(article),
      keywords: this.extractKeywords(text),
      actionItems: this.generateActionItems(article)
    };
  }
  
  /**
   * Analyze sentiment more sophisticatedly
   */
  analyzeSentiment(text) {
    const bullishTerms = [
      'surge', 'soar', 'bullish', 'pump', 'moon', 'rally', 'gains',
      'partnership', 'launch', 'upgrade', 'integration', 'expansion',
      'adoption', 'record', 'all-time high', 'breakthrough', 'innovation',
      'yield', 'opportunity', 'growth', 'success', 'positive'
    ];
    
    const bearishTerms = [
      'crash', 'bearish', 'dump', 'plunge', 'loss', 'hack', 'exploit',
      'warning', 'risk', 'concern', 'investigation', 'fail', 'down',
      'outflow', 'liquidation', 'margin call', 'insolvency', 'bankruptcy',
      'negative', 'decline', 'collapse', 'emergency', 'critical'
    ];
    
    const neutralTerms = [
      'update', 'announcement', 'development', 'proposal', 'test',
      'maintenance', 'change', 'modification'
    ];
    
    const bullishScore = bullishTerms.filter(term => text.includes(term)).length;
    const bearishScore = bearishTerms.filter(term => text.includes(term)).length;
    const neutralScore = neutralTerms.filter(term => text.includes(term)).length;
    
    const total = bullishScore + bearishScore + neutralScore + 1;
    const sentiment = (bullishScore - bearishScore) / total;
    
    return {
      score: Math.max(-1, Math.min(1, sentiment)),
      category: sentiment > 0.3 ? 'bullish' : sentiment < -0.3 ? 'bearish' : 'neutral',
      confidence: (Math.max(bullishScore, bearishScore) / total) * 100
    };
  }
  
  /**
   * Extract protocol mentions
   */
  extractProtocols(text) {
    const found = [];
    
    for (const [protocol, pattern] of Object.entries(this.protocolPatterns)) {
      if (pattern.test(text)) {
        found.push(protocol.toUpperCase());
      }
    }
    
    return found;
  }
  
  /**
   * Assess risk level
   */
  assessRisk(text) {
    for (const [level, keywords] of Object.entries(this.riskKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        return level;
      }
    }
    return 'none';
  }
  
  /**
   * Assess opportunity level
   */
  assessOpportunity(text) {
    for (const [level, keywords] of Object.entries(this.opportunityKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        return level;
      }
    }
    return 'none';
  }
  
  /**
   * Assess overall impact
   */
  assessImpact(article) {
    const text = `${article.title} ${article.description || ''}`.toLowerCase();
    
    // Check for major announcement indicators
    const isMajor = [
      'major', 'breaking', 'urgent', 'critical',
      'announced', 'launch', 'partnership', 'acquisition'
    ].some(term => text.includes(term));
    
    // Check for specific protocol impact
    const impactScore = {
      high: isMajor || text.includes('tvl') || text.includes('exploit'),
      medium: text.includes('update') || text.includes('upgrade'),
      low: true
    };
    
    return isMajor ? 'high' : text.includes('update') ? 'medium' : 'low';
  }
  
  /**
   * Extract key terms
   */
  extractKeywords(text) {
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has'
    ]);
    
    const words = text.split(/\s+/)
      .filter(word => word.length > 4 && !commonWords.has(word))
      .slice(0, 5);
    
    return words;
  }
  
  /**
   * Generate action items
   */
  generateActionItems(article) {
    const text = article.title.toLowerCase();
    const actions = [];
    
    if (text.includes('launch')) actions.push('Track token metrics');
    if (text.includes('hack') || text.includes('exploit')) actions.push('Review security status');
    if (text.includes('partnership')) actions.push('Monitor adoption rate');
    if (text.includes('upgrade')) actions.push('Test new features');
    if (text.includes('yield') || text.includes('apy')) actions.push('Compare yields');
    
    return actions.length > 0 ? actions : ['Monitor for updates'];
  }
  
  /**
   * Identify trends across articles
   */
  identifyTrends(articles) {
    if (!articles || articles.length === 0) {
      return {
        averageSentiment: 0,
        sentimentTrend: 'neutral',
        topProtocols: [],
        newsVelocity: 'low'
      };
    }

    const protocolMentions = {};
    const sentiments = [];
    
    articles.slice(0, 20).forEach(article => {
      const text = `${article.title} ${article.description || ''}`.toLowerCase();
      sentiments.push(article.sentiment || 0);
      
      // Extract protocols directly without recursive call
      for (const [protocol, pattern] of Object.entries(this.protocolPatterns)) {
        if (pattern.test(text)) {
          protocolMentions[protocol] = (protocolMentions[protocol] || 0) + 1;
        }
      }
    });
    
    const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / (sentiments.length || 1);
    
    return {
      averageSentiment: avgSentiment,
      sentimentTrend: avgSentiment > 0.3 ? 'bullish' : avgSentiment < -0.3 ? 'bearish' : 'neutral',
      topProtocols: Object.entries(protocolMentions)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([protocol, count]) => ({ protocol, mentions: count })),
      newsVelocity: articles.length > 5 ? 'high' : articles.length > 2 ? 'medium' : 'low'
    };
  }
  
  /**
   * Identify significant risks
   */
  identifyRisks(articles) {
    const risks = [];
    
    articles.forEach(article => {
      const analysis = this.analyzeArticle(article);
      
      if (analysis.riskLevel === 'high') {
        risks.push({
          severity: 'high',
          title: article.title,
          protocols: analysis.protocols,
          description: article.summary || article.description
        });
      }
    });
    
    return risks;
  }
  
  /**
   * Identify trading opportunities
   */
  identifyOpportunities(articles) {
    const opportunities = [];
    
    articles.forEach(article => {
      const analysis = this.analyzeArticle(article);
      
      if (analysis.opportunityLevel === 'high' && analysis.sentiment.score > 0.3) {
        opportunities.push({
          title: article.title,
          protocols: analysis.protocols,
          confidence: analysis.sentiment.confidence,
          action: this.suggestAction(article),
          timeframe: this.suggestTimeframe(article)
        });
      }
    });
    
    return opportunities;
  }
  
  /**
   * Suggest trading action
   */
  suggestAction(article) {
    const text = article.title.toLowerCase();
    
    if (text.includes('launch')) return 'Monitor and research';
    if (text.includes('partnership')) return 'Consider entering';
    if (text.includes('upgrade')) return 'Watch for adoption';
    if (text.includes('yield')) return 'Compare with alternatives';
    
    return 'Track development';
  }
  
  /**
   * Suggest timeframe
   */
  suggestTimeframe(article) {
    const text = article.title.toLowerCase();
    
    if (text.includes('imminent') || text.includes('soon')) return '24-48 hours';
    if (text.includes('next')) return '1-2 weeks';
    if (text.includes('planned')) return '1-4 weeks';
    
    return 'Ongoing';
  }
  
  /**
   * Generate summary
   */
  generateSummary(articles) {
    if (articles.length === 0) return 'No articles to summarize';
    
    const analysis = this.analyzeNews(articles);
    const trends = analysis.trends;
    const topProtocol = trends.topProtocols[0];
    
    return `${articles.length} articles analyzed. Sentiment: ${trends.sentimentTrend}. ` +
           `Top protocol: ${topProtocol?.protocol || 'N/A'}. ` +
           `News velocity: ${trends.newsVelocity}.`;
  }
}

module.exports = NewsAnalyzer;
