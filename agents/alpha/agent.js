/**
 * Alpha Detection Agent
 * 
 * Comprehensive DeFi protocol scanning for yield, stablecoins, perpetuals, and liquidity opportunities
 * Scoring: 30% TVL/Volume, 20% Yield, 20% Sentiment, 20% Liquidity Flow, 10% News
 */

const { DataFetcher } = require('../shared/dataSources');
const {
  generateInsightId,
  calculateConfidence,
  formatInsight,
  AgentLogger
} = require('../shared/utils');

class AlphaDetectionAgent {
  constructor(config = {}) {
    this.name = 'AlphaDetectionAgent';
    this.logger = new AgentLogger(this.name);
    this.config = {
      minAlphaScore: 50,
      maxMarketCap: 50000000, // $50M
      scanIntervalSeconds: 300, // 5 min
      ...config
    };
    
    this.dataFetcher = new DataFetcher(config.apiKeys || {});
    this.protocols = this.getDefaultProtocols();
    this.alphaCache = new Map();
  }
  
  /**
   * Scan all protocols for alpha opportunities
   */
  async scanForAlpha(context = {}) {
    const startTime = Date.now();
    this.logger.debug('Starting alpha scan', { protocolCount: this.protocols.length });
    
    try {
      const alphaSignals = [];
      
      // Scan each protocol
      for (const protocol of this.protocols) {
        try {
          const signal = await this.analyzeProtocol(protocol);
          if (signal && signal.alphaScore >= this.config.minAlphaScore) {
            alphaSignals.push(signal);
          }
        } catch (err) {
          this.logger.debug(`Failed to analyze ${protocol}`, { error: err.message });
        }
      }
      
      // Sort by alpha score
      alphaSignals.sort((a, b) => b.alphaScore - a.alphaScore);
      
      return {
        type: 'alpha_scan',
        timestamp: new Date().toISOString(),
        protocolsScanned: this.protocols.length,
        alphaOpportunities: alphaSignals.slice(0, 10),
        summary: this.generateAlphaSummary(alphaSignals),
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      this.logger.error('Alpha scan failed', { error: err.message });
      return {
        type: 'alpha_scan',
        alphaOpportunities: [],
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Analyze single protocol for alpha
   */
  async analyzeProtocol(protocolName) {
    const cacheKey = `alpha_${protocolName}`;
    const cached = this.alphaCache.get(cacheKey);
    
    // Use cache if recent (5 min TTL)
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.data;
    }
    
    try {
      // Fetch protocol data
      const [defiData, sentiment, news] = await Promise.all([
        this.dataFetcher.defi.fetchProtocolData(protocolName),
        this.dataFetcher.sentiment.analyzeSentiment([protocolName]),
        this.dataFetcher.news.fetchNews([protocolName], 5)
      ]);
      
      // Skip if no DeFi data
      if (!defiData) return null;
      
      // Calculate alpha score
      const scores = {
        tvlVolume: this.scoreTVLVolume(defiData),
        yield: this.scoreYield(defiData),
        sentiment: this.scoreSentiment(sentiment),
        liquidityFlow: this.scoreLiquidityFlow(defiData),
        newsImpact: this.scoreNewsImpact(news)
      };
      
      const alphaScore = this.calculateAlphaScore(scores);
      
      const signal = {
        id: generateInsightId(),
        type: 'alpha_opportunity',
        protocol: protocolName,
        alphaScore,
        scores,
        metrics: {
          tvl: defiData.tvl,
          tvlChange7d: defiData.metrics.tvlChange7d,
          apy: defiData.metrics.yield,
          sentiment: sentiment.score,
          newsCount: news.length
        },
        category: this.categorizeOpportunity(defiData, scores),
        mechanics: this.getProtocolMechanics(protocolName),
        pros: this.getProtocolPros(protocolName),
        cons: this.getProtocolCons(protocolName),
        differentiators: this.getProtocolDifferentiators(protocolName),
        summary: this.generateProtocolSummary(protocolName, defiData, scores),
        timestamp: new Date().toISOString()
      };
      
      // Cache result
      this.alphaCache.set(cacheKey, { data: signal, timestamp: Date.now() });
      
      return signal;
    } catch (err) {
      this.logger.debug(`Analysis error for ${protocolName}`, { error: err.message });
      return null;
    }
  }
  
  /**
   * Score TVL and volume growth
   * Weight: 30%
   */
  scoreTVLVolume(defiData) {
    const tvl = defiData.tvl || 0;
    const growth = Math.max(defiData.metrics.tvlChange7d || 0, 0);
    
    // Normalize: TVL scaling + growth bonus
    const tvlScore = Math.min(tvl / 1000000000, 1); // Max at $1B
    const growthScore = Math.min(growth / 50, 1); // Max at 50% growth
    
    return (tvlScore * 0.6 + growthScore * 0.4);
  }
  
  /**
   * Score yield opportunities
   * Weight: 20%
   */
  scoreYield(defiData) {
    const apy = defiData.metrics.yield || 0;
    
    // Scale: 0% = 0, 5% = 0.3, 20% = 0.8, 100%+ = 1.0
    if (apy < 2) return 0.1;
    if (apy < 5) return 0.3;
    if (apy < 10) return 0.5;
    if (apy < 20) return 0.75;
    return Math.min(apy / 100, 1);
  }
  
  /**
   * Score sentiment
   * Weight: 20%
   */
  scoreSentiment(sentiment) {
    // Normalize sentiment (-1 to +1) to (0 to 1)
    return (sentiment.score + 1) / 2;
  }
  
  /**
   * Score liquidity flow
   * Weight: 20%
   */
  scoreLiquidityFlow(defiData) {
    const inflow = defiData.metrics.tvlChange7d || 0;
    
    // Positive inflow = alpha, negative = exit
    if (inflow > 20) return 0.9; // 20%+ inflow
    if (inflow > 10) return 0.7; // 10-20% inflow
    if (inflow > 0) return 0.5; // Some inflow
    if (inflow > -10) return 0.3; // Minor outflow
    return 0.1; // Major outflow
  }
  
  /**
   * Score news impact
   * Weight: 10%
   */
  scoreNewsImpact(newsArticles) {
    if (newsArticles.length === 0) return 0.2;
    
    // More recent + positive news = higher score
    const avgSentiment = newsArticles.reduce((sum, n) => sum + (n.sentiment || 0), 0) / newsArticles.length;
    const recencyScore = Math.min(newsArticles.length / 5, 1); // Max at 5+ articles
    
    return (avgSentiment + 1) / 2 * 0.6 + recencyScore * 0.4;
  }
  
  /**
   * Calculate weighted alpha score (0-100)
   */
  calculateAlphaScore(scores) {
    const weighted =
      scores.tvlVolume * 0.30 +
      scores.yield * 0.20 +
      scores.sentiment * 0.20 +
      scores.liquidityFlow * 0.20 +
      scores.newsImpact * 0.10;
    
    return Math.round(weighted * 100);
  }
  
  /**
   * Categorize opportunity type
   */
  categorizeOpportunity(defiData, scores) {
    if (scores.yield > 0.7) return 'yield_farming';
    if (scores.tvlVolume > 0.7 && scores.liquidityFlow > 0.6) return 'emerging_protocol';
    if (scores.sentiment > 0.7) return 'bullish_narrative';
    return 'balanced_opportunity';
  }
  
  /**
   * Get protocol mechanics
   */
  getProtocolMechanics(protocolName) {
    const mechanics = {
      'AAVE': { type: 'Lending', description: 'Overcollateralized lending with risk management' },
      'CURVE': { type: 'AMM', description: 'Stablecoin-focused AMM with low slippage' },
      'UNISWAP': { type: 'DEX/AMM', description: 'Multi-tier fee DEX with concentrated liquidity' },
      'LIDO': { type: 'Liquid Staking', description: 'Ethereum staking derivatives with stETH' },
      'YEARN': { type: 'Yield Optimizer', description: 'Automated yield farming strategies' },
      'COMPOUND': { type: 'Lending', description: 'Algorithmic money market protocol' },
      'CONVEX': { type: 'Curve Wrapper', description: 'Boost and optimize Curve rewards' },
      'BALANCER': { type: 'AMM/Exchange', description: 'Flexible automated portfolio manager' }
    };
    
    return mechanics[protocolName.toUpperCase()] || { type: 'Unknown', description: 'Protocol mechanics not mapped' };
  }
  
  /**
   * Get protocol pros
   */
  getProtocolPros(protocolName) {
    const pros = {
      'AAVE': ['Flash loans', 'Multi-chain deployment', 'High TVL liquidity', 'Risk parameters'],
      'CURVE': ['Low slippage', 'Stablecoin focus', 'High yields', 'Deep liquidity'],
      'UNISWAP': ['Leading DEX', 'Governance token', 'Cross-chain', 'V4 features'],
      'LIDO': ['Liquid staking', 'Ethereum aligned', 'DeFi composability', 'High TVL'],
      'YEARN': ['Automated strategies', 'Risk-adjusted yields', 'Multi-chain', 'Active management'],
      'COMPOUND': ['Established protocol', 'Governance', 'Risk management', 'Composable']
    };
    
    return pros[protocolName.toUpperCase()] || ['Research further'];
  }
  
  /**
   * Get protocol cons
   */
  getProtocolCons(protocolName) {
    const cons = {
      'AAVE': ['Liquidation risk', 'Market-dependent', 'Complex parameters', 'High gas costs'],
      'CURVE': ['IL risk in non-stable pools', 'Governance concentration', 'Fee dependency'],
      'UNISWAP': ['IL risk', 'Gas costs', 'Complex mechanics'],
      'LIDO': ['Centralization risk', 'Liquid staking risk', 'Regulatory exposure'],
      'YEARN': ['Strategy risk', 'Operational overhead', 'Gas costs'],
      'COMPOUND': ['Liquidation risk', 'Price oracle dependency', 'Smart contract risk']
    };
    
    return cons[protocolName.toUpperCase()] || ['Risk assessment needed'];
  }
  
  /**
   * Get protocol differentiators
   */
  getProtocolDifferentiators(protocolName) {
    const diff = {
      'AAVE': 'Flash loans, multi-chain expansion, isolation mode',
      'CURVE': 'Stablecoin specialists with low slippage',
      'UNISWAP': 'Leading DEX with V4 innovation',
      'LIDO': 'Dominant liquid staking solution',
      'YEARN': 'Yield optimization and strategy automation',
      'COMPOUND': 'Pioneer in algorithmic money markets'
    };
    
    return diff[protocolName.toUpperCase()] || 'Protocol specifics unknown';
  }
  
  /**
   * Generate protocol summary
   */
  generateProtocolSummary(protocolName, defiData, scores) {
    const parts = [];
    const mechanics = this.getProtocolMechanics(protocolName);
    
    parts.push(`${protocolName} (${mechanics.type})`);
    
    if (defiData.tvl) {
      parts.push(`$${(defiData.tvl / 1000000).toFixed(1)}M TVL`);
    }
    
    if (scores.yield > 0.6) {
      parts.push(`${(defiData.metrics.yield || 0).toFixed(1)}% APY`);
    }
    
    if (scores.liquidityFlow > 0.6) {
      parts.push(`+${(defiData.metrics.tvlChange7d || 0).toFixed(1)}% 7d growth`);
    }
    
    if (scores.sentiment > 0.6) {
      parts.push('Positive sentiment');
    }
    
    return parts.join(' • ');
  }
  
  /**
   * Generate summary for all alphas
   */
  generateAlphaSummary(signals) {
    if (signals.length === 0) return 'No alpha opportunities detected.';
    
    const topSignal = signals[0];
    const categories = {};
    
    signals.forEach(s => {
      categories[s.category] = (categories[s.category] || 0) + 1;
    });
    
    const categorySummary = Object.entries(categories)
      .map(([cat, count]) => `${count} ${cat}`)
      .join(', ');
    
    return `Top alpha: ${topSignal.protocol} (${topSignal.alphaScore}/100). Categories: ${categorySummary}`;
  }
  
  /**
   * Get default protocol list
   */
  getDefaultProtocols() {
    return [
      'AAVE', 'CURVE', 'UNISWAP', 'LIDO', 'COMPOUND', 'YEARN',
      'CONVEX', 'BALANCER', 'SUSHISWAP', 'MAKER', 'SYNTHETIX',
      'DYDX', 'GMX', 'PENDLE', 'FUEL', 'SCROLL'
    ];
  }
  
  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: '1.0.0',
      type: 'alpha_detection',
      capabilities: [
        'protocol_scanning',
        'defi_analysis',
        'yield_tracking',
        'liquidity_flow_monitoring',
        'news_impact_scoring',
        'opportunity_ranking'
      ],
      requiredData: ['defi_metrics', 'sentiment', 'news', 'prices'],
      outputFormat: 'alpha_signal',
      scanFrequency: '5 minutes',
      protocolCoverage: this.protocols.length
    };
  }
}

module.exports = AlphaDetectionAgent;
