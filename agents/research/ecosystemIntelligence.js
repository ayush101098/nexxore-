/**
 * Ecosystem Intelligence Collector
 * 
 * Provides on-chain analyst level insights:
 * - Top categories & narratives
 * - Leading protocols per narrative
 * - TVL trends & capital flows
 * - Ecosystem health metrics
 */

const DEFILLAMA_BASE = 'https://api.llama.fi';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Narrative categories and their associated protocols
const NARRATIVES = {
  'AI_AGENTS': {
    name: 'AI Agents & Compute',
    description: 'Decentralized AI, compute networks, and autonomous agents',
    protocols: ['bittensor', 'render', 'akash-network', 'fetch-ai', 'ocean-protocol', 'singularitynet'],
    coingeckoIds: ['bittensor', 'render-token', 'akash-network', 'fetch-ai', 'ocean-protocol', 'singularitynet'],
    thesis: 'AI narrative heating up as compute demand grows. Watch for protocol revenue and usage metrics.',
    riskLevel: 'HIGH'
  },
  'LIQUID_STAKING': {
    name: 'Liquid Staking',
    description: 'Staking derivatives and liquid staking protocols',
    protocols: ['lido', 'rocket-pool', 'frax-ether', 'stakewise', 'swell'],
    coingeckoIds: ['lido-dao', 'rocket-pool', 'frax-ether', 'stakewise', 'swell-network'],
    thesis: 'Mature category with stable yields. Focus on market share shifts and restaking integration.',
    riskLevel: 'LOW'
  },
  'RESTAKING': {
    name: 'Restaking & AVS',
    description: 'EigenLayer ecosystem and restaking protocols',
    protocols: ['eigenlayer', 'ether.fi', 'kelp-dao', 'puffer-finance', 'renzo'],
    coingeckoIds: ['eigenlayer', 'ether-fi', 'kelp-dao', 'puffer-finance', 'renzo'],
    thesis: 'Restaking unlocks new yield sources. Watch AVS launches and points programs.',
    riskLevel: 'MEDIUM'
  },
  'PERP_DEX': {
    name: 'Perpetual DEXs',
    description: 'Decentralized perpetual exchanges',
    protocols: ['gmx', 'hyperliquid', 'dydx', 'vertex-protocol', 'drift'],
    coingeckoIds: ['gmx', 'hyperliquid', 'dydx-chain', 'vertex-protocol', 'drift-protocol'],
    thesis: 'Volume migration from CEX to DEX accelerating. Track OI growth and fee revenue.',
    riskLevel: 'MEDIUM'
  },
  'RWA': {
    name: 'Real World Assets',
    description: 'Tokenized treasuries, real estate, and private credit',
    protocols: ['maker-rwa', 'ondo-finance', 'centrifuge', 'maple', 'goldfinch'],
    coingeckoIds: ['maker', 'ondo-finance', 'centrifuge', 'maple', 'goldfinch'],
    thesis: 'Institutional adoption driver. Monitor treasury yields vs DeFi rates.',
    riskLevel: 'LOW'
  },
  'L2_ECOSYSTEM': {
    name: 'Layer 2 Ecosystem',
    description: 'Ethereum L2s and their native DeFi',
    protocols: ['arbitrum', 'optimism', 'base', 'zksync-era', 'linea', 'scroll'],
    coingeckoIds: ['arbitrum', 'optimism', 'base', 'zksync', 'linea', 'scroll'],
    thesis: 'L2 wars continue. Track sequencer revenue and blob fee dynamics.',
    riskLevel: 'MEDIUM'
  },
  'DEPIN': {
    name: 'DePIN',
    description: 'Decentralized Physical Infrastructure Networks',
    protocols: ['helium', 'hivemapper', 'dimo', 'io-net', 'grass'],
    coingeckoIds: ['helium', 'hivemapper', 'dimo', 'io-net', 'grass'],
    thesis: 'Real-world utility narrative. Watch network growth and hardware deployments.',
    riskLevel: 'HIGH'
  },
  'YIELD_OPTIMIZATION': {
    name: 'Yield & Points',
    description: 'Yield aggregators and points meta plays',
    protocols: ['pendle', 'yearn-finance', 'convex-finance', 'aura-finance', 'equilibria'],
    coingeckoIds: ['pendle', 'yearn-finance', 'convex-finance', 'aura-finance', 'equilibria'],
    thesis: 'Points meta driving TVL. Pendle leading yield speculation.',
    riskLevel: 'MEDIUM'
  },
  'SOLANA_DEFI': {
    name: 'Solana DeFi',
    description: 'Native Solana DeFi protocols',
    protocols: ['jupiter', 'raydium', 'marinade', 'jito', 'drift'],
    coingeckoIds: ['jupiter-exchange-solana', 'raydium', 'marinade-staked-sol', 'jito-governance-token', 'drift-protocol'],
    thesis: 'Solana DeFi renaissance. Track DEX volume and validator economics.',
    riskLevel: 'MEDIUM'
  },
  'STABLECOINS': {
    name: 'Stablecoins & CDP',
    description: 'Stablecoin protocols and collateralized debt',
    protocols: ['makerdao', 'ethena', 'frax', 'liquity', 'prisma'],
    coingeckoIds: ['maker', 'ethena', 'frax', 'liquity', 'prisma-mkusd'],
    thesis: 'Stablecoin dominance shifting. Ethena disrupting with basis trade model.',
    riskLevel: 'MEDIUM'
  }
};

class EcosystemIntelligence {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get full ecosystem overview
   */
  async getEcosystemOverview() {
    const cacheKey = 'ecosystem_overview';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      // Fetch data in parallel
      const [categories, topProtocols, tvlTrends] = await Promise.all([
        this.getCategoryBreakdown(),
        this.getTopProtocolsByTVL(),
        this.getTVLTrends()
      ]);

      const overview = {
        timestamp: Date.now(),
        categories,
        topProtocols,
        tvlTrends,
        narratives: await this.getNarrativeAnalysis()
      };

      this.cache.set(cacheKey, { data: overview, timestamp: Date.now() });
      return overview;

    } catch (error) {
      console.error('Ecosystem overview error:', error);
      return this._getFallbackOverview();
    }
  }

  /**
   * Get category breakdown from DeFiLlama
   */
  async getCategoryBreakdown() {
    try {
      const response = await fetch(`${DEFILLAMA_BASE}/categories`);
      if (!response.ok) throw new Error('Categories fetch failed');
      
      const data = await response.json();
      
      // Map to our narrative categories
      const categoryMap = {};
      for (const [key, narrative] of Object.entries(NARRATIVES)) {
        categoryMap[key] = {
          ...narrative,
          tvl: 0,
          tvlChange24h: 0,
          protocolCount: narrative.protocols.length
        };
      }

      return {
        totalTVL: data.reduce((sum, cat) => sum + (cat.tvl || 0), 0),
        topCategories: data.slice(0, 10).map(cat => ({
          name: cat.name,
          tvl: cat.tvl,
          change24h: cat.change_1d || 0
        })),
        narratives: categoryMap
      };

    } catch (error) {
      console.warn('Category breakdown error:', error);
      return { totalTVL: 0, topCategories: [], narratives: NARRATIVES };
    }
  }

  /**
   * Get top protocols by TVL
   */
  async getTopProtocolsByTVL() {
    try {
      const response = await fetch(`${DEFILLAMA_BASE}/protocols`);
      if (!response.ok) throw new Error('Protocols fetch failed');
      
      const protocols = await response.json();
      
      return protocols
        .filter(p => p.tvl > 0)
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, 20)
        .map(p => ({
          name: p.name,
          symbol: p.symbol,
          tvl: p.tvl,
          tvlChange24h: p.change_1d || 0,
          tvlChange7d: p.change_7d || 0,
          category: p.category,
          chains: p.chains || [],
          mcapTvl: p.mcap && p.tvl ? (p.mcap / p.tvl).toFixed(2) : null
        }));

    } catch (error) {
      console.warn('Top protocols error:', error);
      return [];
    }
  }

  /**
   * Get TVL trends over time
   */
  async getTVLTrends() {
    try {
      const response = await fetch(`${DEFILLAMA_BASE}/v2/historicalChainTvl`);
      if (!response.ok) throw new Error('TVL history fetch failed');
      
      const data = await response.json();
      
      // Get last 30 days
      const recent = data.slice(-30);
      const currentTVL = recent[recent.length - 1]?.tvl || 0;
      const tvl7dAgo = recent[recent.length - 8]?.tvl || currentTVL;
      const tvl30dAgo = recent[0]?.tvl || currentTVL;

      return {
        current: currentTVL,
        change7d: ((currentTVL - tvl7dAgo) / tvl7dAgo * 100).toFixed(2),
        change30d: ((currentTVL - tvl30dAgo) / tvl30dAgo * 100).toFixed(2),
        trend: currentTVL > tvl7dAgo ? 'EXPANDING' : 'CONTRACTING',
        history: recent.map(d => ({ date: new Date(d.date * 1000).toISOString().split('T')[0], tvl: d.tvl }))
      };

    } catch (error) {
      console.warn('TVL trends error:', error);
      return { current: 0, change7d: '0', change30d: '0', trend: 'UNKNOWN', history: [] };
    }
  }

  /**
   * Analyze narratives with price and TVL data
   */
  async getNarrativeAnalysis() {
    const narratives = [];

    for (const [key, narrative] of Object.entries(NARRATIVES)) {
      try {
        // Fetch prices for narrative tokens
        const ids = narrative.coingeckoIds.join(',');
        const priceResponse = await fetch(
          `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true`
        );
        
        let priceData = {};
        if (priceResponse.ok) {
          priceData = await priceResponse.json();
        }

        // Calculate narrative performance
        let totalChange24h = 0;
        let totalChange7d = 0;
        let tokenCount = 0;

        const tokens = narrative.coingeckoIds.map(id => {
          const data = priceData[id];
          if (data) {
            totalChange24h += data.usd_24h_change || 0;
            totalChange7d += data.usd_7d_change || 0;
            tokenCount++;
          }
          return {
            id,
            price: data?.usd || 0,
            change24h: data?.usd_24h_change || 0,
            change7d: data?.usd_7d_change || 0
          };
        });

        const avgChange24h = tokenCount > 0 ? totalChange24h / tokenCount : 0;
        const avgChange7d = tokenCount > 0 ? totalChange7d / tokenCount : 0;

        // Determine narrative momentum
        let momentum = 'NEUTRAL';
        if (avgChange24h > 5 && avgChange7d > 10) momentum = 'STRONG_BULLISH';
        else if (avgChange24h > 2 && avgChange7d > 5) momentum = 'BULLISH';
        else if (avgChange24h < -5 && avgChange7d < -10) momentum = 'STRONG_BEARISH';
        else if (avgChange24h < -2 && avgChange7d < -5) momentum = 'BEARISH';

        narratives.push({
          key,
          name: narrative.name,
          description: narrative.description,
          thesis: narrative.thesis,
          riskLevel: narrative.riskLevel,
          momentum,
          avgChange24h: avgChange24h.toFixed(2),
          avgChange7d: avgChange7d.toFixed(2),
          topTokens: tokens.sort((a, b) => b.change24h - a.change24h).slice(0, 3)
        });

        // Rate limit
        await new Promise(r => setTimeout(r, 200));

      } catch (error) {
        console.warn(`Narrative ${key} analysis error:`, error);
        narratives.push({
          key,
          name: narrative.name,
          description: narrative.description,
          thesis: narrative.thesis,
          riskLevel: narrative.riskLevel,
          momentum: 'UNKNOWN',
          avgChange24h: '0',
          avgChange7d: '0',
          topTokens: []
        });
      }
    }

    // Sort by momentum strength
    const momentumOrder = { 'STRONG_BULLISH': 5, 'BULLISH': 4, 'NEUTRAL': 3, 'BEARISH': 2, 'STRONG_BEARISH': 1, 'UNKNOWN': 0 };
    return narratives.sort((a, b) => momentumOrder[b.momentum] - momentumOrder[a.momentum]);
  }

  /**
   * Get protocols for a specific narrative
   */
  async getNarrativeProtocols(narrativeKey) {
    const narrative = NARRATIVES[narrativeKey];
    if (!narrative) return null;

    try {
      const protocols = [];
      
      for (const protocolId of narrative.protocols) {
        try {
          const response = await fetch(`${DEFILLAMA_BASE}/protocol/${protocolId}`);
          if (response.ok) {
            const data = await response.json();
            protocols.push({
              name: data.name,
              symbol: data.symbol,
              tvl: data.tvl,
              tvlChange24h: data.change_1d || 0,
              tvlChange7d: data.change_7d || 0,
              chains: data.chains || [],
              category: data.category,
              description: data.description?.slice(0, 200) || '',
              url: data.url,
              twitter: data.twitter
            });
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.warn(`Protocol ${protocolId} fetch error:`, e);
        }
      }

      return {
        narrative: narrative.name,
        thesis: narrative.thesis,
        riskLevel: narrative.riskLevel,
        protocols: protocols.sort((a, b) => b.tvl - a.tvl)
      };

    } catch (error) {
      console.error('Narrative protocols error:', error);
      return null;
    }
  }

  _getFallbackOverview() {
    return {
      timestamp: Date.now(),
      categories: { totalTVL: 0, topCategories: [], narratives: NARRATIVES },
      topProtocols: [],
      tvlTrends: { current: 0, change7d: '0', change30d: '0', trend: 'UNKNOWN', history: [] },
      narratives: Object.entries(NARRATIVES).map(([key, n]) => ({
        key,
        name: n.name,
        description: n.description,
        thesis: n.thesis,
        riskLevel: n.riskLevel,
        momentum: 'UNKNOWN',
        avgChange24h: '0',
        avgChange7d: '0',
        topTokens: []
      }))
    };
  }
}

module.exports = { EcosystemIntelligence, NARRATIVES };
