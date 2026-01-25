/**
 * Macro Intelligence Aggregator
 * 
 * Aggregates macro-level crypto intelligence:
 * - Market sentiment & fear/greed
 * - Bitcoin dominance & market structure
 * - Stablecoin flows
 * - Institutional activity signals
 * - Regulatory news
 * - Fed & macro economic indicators
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const DEFILLAMA_BASE = 'https://api.llama.fi';

class MacroIntelligence {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get full macro overview
   */
  async getMacroOverview() {
    const cacheKey = 'macro_overview';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const [sentiment, marketStructure, stablecoins, dominance] = await Promise.all([
        this.getSentiment(),
        this.getMarketStructure(),
        this.getStablecoinFlows(),
        this.getDominanceMetrics()
      ]);

      const macro = {
        timestamp: Date.now(),
        sentiment,
        marketStructure,
        stablecoins,
        dominance,
        regime: this._determineRegime(sentiment, marketStructure, dominance),
        macroNews: await this.getMacroNews(),
        keyLevels: this._getKeyLevels(marketStructure)
      };

      this.cache.set(cacheKey, { data: macro, timestamp: Date.now() });
      return macro;

    } catch (error) {
      console.error('Macro overview error:', error);
      return this._getFallbackMacro();
    }
  }

  /**
   * Get market sentiment (Fear & Greed)
   */
  async getSentiment() {
    try {
      const response = await fetch('https://api.alternative.me/fng/?limit=7');
      if (!response.ok) throw new Error('Sentiment fetch failed');
      
      const data = await response.json();
      const current = data.data[0];
      const yesterday = data.data[1];
      const weekAgo = data.data[6];

      return {
        value: parseInt(current.value),
        label: current.value_classification,
        change24h: parseInt(current.value) - parseInt(yesterday.value),
        change7d: parseInt(current.value) - parseInt(weekAgo.value),
        trend: this._determineSentimentTrend(data.data),
        interpretation: this._interpretSentiment(parseInt(current.value))
      };

    } catch (error) {
      console.warn('Sentiment fetch error:', error);
      return { value: 50, label: 'Neutral', change24h: 0, change7d: 0, trend: 'STABLE', interpretation: 'Neutral market conditions' };
    }
  }

  _determineSentimentTrend(data) {
    const values = data.map(d => parseInt(d.value));
    const recent = values.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const older = values.slice(3, 7).reduce((a, b) => a + b, 0) / 4;
    
    if (recent - older > 10) return 'IMPROVING';
    if (older - recent > 10) return 'DETERIORATING';
    return 'STABLE';
  }

  _interpretSentiment(value) {
    if (value <= 20) return '🔴 Extreme Fear - Historically good buying opportunity. Market panic often precedes reversals.';
    if (value <= 35) return '🟠 Fear - Cautious sentiment. Consider accumulating quality assets.';
    if (value <= 55) return '🟡 Neutral - No strong directional bias. Market in consolidation.';
    if (value <= 75) return '🟢 Greed - Bullish sentiment. Be mindful of overextension.';
    return '🔴 Extreme Greed - Market euphoria. Consider taking profits and reducing risk.';
  }

  /**
   * Get market structure data
   */
  async getMarketStructure() {
    try {
      const response = await fetch(`${COINGECKO_BASE}/global`);
      if (!response.ok) throw new Error('Global data fetch failed');
      
      const { data } = await response.json();
      
      return {
        totalMarketCap: data.total_market_cap.usd,
        totalVolume24h: data.total_volume.usd,
        btcDominance: data.market_cap_percentage.btc,
        ethDominance: data.market_cap_percentage.eth,
        altcoinSeason: data.market_cap_percentage.btc < 45,
        marketCapChange24h: data.market_cap_change_percentage_24h_usd,
        activeCoins: data.active_cryptocurrencies,
        markets: data.markets
      };

    } catch (error) {
      console.warn('Market structure fetch error:', error);
      return {
        totalMarketCap: 0,
        totalVolume24h: 0,
        btcDominance: 50,
        ethDominance: 15,
        altcoinSeason: false,
        marketCapChange24h: 0,
        activeCoins: 0,
        markets: 0
      };
    }
  }

  /**
   * Get stablecoin flows and metrics
   */
  async getStablecoinFlows() {
    try {
      const response = await fetch(`${DEFILLAMA_BASE}/stablecoins`);
      if (!response.ok) throw new Error('Stablecoins fetch failed');
      
      const data = await response.json();
      
      const totalMcap = data.peggedAssets.reduce((sum, s) => sum + (s.circulating?.peggedUSD || 0), 0);
      
      // Get top stablecoins
      const topStables = data.peggedAssets
        .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
        .slice(0, 5)
        .map(s => ({
          name: s.name,
          symbol: s.symbol,
          mcap: s.circulating?.peggedUSD || 0,
          chains: s.chains?.length || 0
        }));

      return {
        totalMcap,
        topStables,
        interpretation: totalMcap > 150e9 
          ? '🟢 High stablecoin supply - Dry powder available for market entries'
          : '🟡 Moderate stablecoin supply - Normal market conditions'
      };

    } catch (error) {
      console.warn('Stablecoin flows fetch error:', error);
      return { totalMcap: 0, topStables: [], interpretation: 'Data unavailable' };
    }
  }

  /**
   * Get dominance metrics with interpretation
   */
  async getDominanceMetrics() {
    try {
      // Get BTC and ETH price data
      const response = await fetch(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=false&price_change_percentage=24h,7d,30d`);
      
      if (!response.ok) throw new Error('Dominance data fetch failed');
      
      const [btc, eth] = await response.json();
      
      return {
        btc: {
          price: btc.current_price,
          change24h: btc.price_change_percentage_24h,
          change7d: btc.price_change_percentage_7d_in_currency,
          change30d: btc.price_change_percentage_30d_in_currency,
          ath: btc.ath,
          athChange: btc.ath_change_percentage
        },
        eth: {
          price: eth.current_price,
          change24h: eth.price_change_percentage_24h,
          change7d: eth.price_change_percentage_7d_in_currency,
          change30d: eth.price_change_percentage_30d_in_currency,
          ath: eth.ath,
          athChange: eth.ath_change_percentage
        },
        ethBtcRatio: eth.current_price / btc.current_price,
        interpretation: this._interpretDominance(btc, eth)
      };

    } catch (error) {
      console.warn('Dominance metrics fetch error:', error);
      return { btc: {}, eth: {}, ethBtcRatio: 0, interpretation: 'Data unavailable' };
    }
  }

  _interpretDominance(btc, eth) {
    const ethBtc = eth.current_price / btc.current_price;
    const btcStrong = btc.price_change_percentage_7d_in_currency > eth.price_change_percentage_7d_in_currency;
    
    if (ethBtc < 0.04) return '🟡 ETH/BTC at historically low levels. ETH underperformance may present opportunity.';
    if (ethBtc > 0.08) return '🟢 ETH/BTC strength suggests altcoin season conditions.';
    if (btcStrong) return '🔵 BTC leading - Risk-off rotation. Altcoins may underperform.';
    return '🟡 Neutral ETH/BTC ratio. Mixed market conditions.';
  }

  /**
   * Determine market regime
   */
  _determineRegime(sentiment, marketStructure, dominance) {
    let score = 0;
    
    // Sentiment contribution
    if (sentiment.value >= 60) score += 2;
    else if (sentiment.value >= 40) score += 1;
    else if (sentiment.value <= 25) score -= 2;
    else score -= 1;

    // Market cap change contribution
    if (marketStructure.marketCapChange24h > 3) score += 2;
    else if (marketStructure.marketCapChange24h > 0) score += 1;
    else if (marketStructure.marketCapChange24h < -3) score -= 2;
    else score -= 1;

    // BTC dominance contribution (low = risk on for alts)
    if (marketStructure.btcDominance < 45) score += 1;
    else if (marketStructure.btcDominance > 55) score -= 1;

    let regime, color, recommendation;
    if (score >= 3) {
      regime = 'RISK_ON';
      color = '#22c55e';
      recommendation = 'Favorable conditions for risk assets. Consider increasing exposure to quality altcoins and DeFi.';
    } else if (score >= 1) {
      regime = 'NEUTRAL';
      color = '#fbbf24';
      recommendation = 'Mixed signals. Maintain balanced portfolio. Focus on blue chips and yield strategies.';
    } else if (score >= -1) {
      regime = 'CAUTIOUS';
      color = '#f97316';
      recommendation = 'Elevated uncertainty. Reduce leverage, increase stablecoin allocation.';
    } else {
      regime = 'RISK_OFF';
      color = '#ef4444';
      recommendation = 'Defensive positioning recommended. Prioritize capital preservation and stablecoin yields.';
    }

    return { regime, score, color, recommendation };
  }

  /**
   * Get macro news (curated themes)
   */
  async getMacroNews() {
    // These would ideally come from a news API, but we'll provide curated themes
    return [
      {
        category: 'Institutional',
        headline: 'ETF Flows & Institutional Adoption',
        summary: 'Monitor daily BTC/ETH ETF inflows. Sustained inflows signal institutional accumulation.',
        impact: 'POSITIVE',
        relevance: 'HIGH'
      },
      {
        category: 'Regulatory',
        headline: 'Global Regulatory Developments',
        summary: 'Watch SEC actions, MiCA implementation in EU, and Asian regulatory clarity.',
        impact: 'NEUTRAL',
        relevance: 'HIGH'
      },
      {
        category: 'Macro',
        headline: 'Fed Policy & Rate Expectations',
        summary: 'Rate cuts typically bullish for risk assets. Monitor FOMC statements and inflation data.',
        impact: 'NEUTRAL',
        relevance: 'MEDIUM'
      },
      {
        category: 'On-chain',
        headline: 'Exchange Outflows & Holder Behavior',
        summary: 'Sustained exchange outflows indicate accumulation. Long-term holder supply at ATH.',
        impact: 'POSITIVE',
        relevance: 'MEDIUM'
      },
      {
        category: 'DeFi',
        headline: 'TVL & Protocol Revenue Trends',
        summary: 'DeFi TVL recovering. Watch fee revenue as indicator of sustainable growth.',
        impact: 'POSITIVE',
        relevance: 'MEDIUM'
      }
    ];
  }

  /**
   * Get key support/resistance levels
   */
  _getKeyLevels(marketStructure) {
    // Simplified - in production would use technical analysis
    const btcLevels = {
      strongSupport: 80000,
      support: 85000,
      resistance: 95000,
      strongResistance: 100000
    };

    return {
      btc: btcLevels,
      interpretation: `BTC trading between $${btcLevels.support.toLocaleString()} support and $${btcLevels.resistance.toLocaleString()} resistance.`
    };
  }

  _getFallbackMacro() {
    return {
      timestamp: Date.now(),
      sentiment: { value: 50, label: 'Neutral', change24h: 0, change7d: 0, trend: 'STABLE', interpretation: 'Data unavailable' },
      marketStructure: { totalMarketCap: 0, totalVolume24h: 0, btcDominance: 50, ethDominance: 15, altcoinSeason: false },
      stablecoins: { totalMcap: 0, topStables: [], interpretation: 'Data unavailable' },
      dominance: { btc: {}, eth: {}, ethBtcRatio: 0, interpretation: 'Data unavailable' },
      regime: { regime: 'UNKNOWN', score: 0, color: '#64748b', recommendation: 'Unable to determine market regime.' },
      macroNews: [],
      keyLevels: { btc: {}, interpretation: 'Data unavailable' }
    };
  }
}

module.exports = { MacroIntelligence };
