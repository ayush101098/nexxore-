/**
 * Web3 Token Hub
 * 
 * Comprehensive token database with:
 * - Token info (contract, chain, decimals)
 * - Security data (audits, trust score)
 * - Market data (price, volume, holders)
 * - Community data (socials, engagement)
 * - Risk assessment
 */

const { AgentLogger } = require('./utils');

class Web3TokenHub {
  constructor(config = {}) {
    this.name = 'Web3TokenHub';
    this.logger = new AgentLogger(this.name);
    this.tokenDatabase = new Map();
    this.config = config;
  }
  
  /**
   * Get token info with trust score
   */
  async getTokenInfo(tokenSymbol, chain = 'ethereum') {
    const key = `${tokenSymbol.toLowerCase()}_${chain}`;
    
    // Check cache
    const cached = this.tokenDatabase.get(key);
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return cached.data;
    }
    
    try {
      const tokenData = await this.fetchTokenData(tokenSymbol, chain);
      const trustScore = this.calculateTrustScore(tokenData);
      
      const info = {
        symbol: tokenSymbol,
        chain,
        name: tokenData.name,
        contractAddress: tokenData.contract,
        decimals: tokenData.decimals,
        launchDate: tokenData.launchDate,
        trustScore,
        riskLevel: this.assessRisk(trustScore),
        marketData: {
          price: tokenData.price,
          marketCap: tokenData.marketCap,
          volume24h: tokenData.volume24h,
          circulatingSupply: tokenData.circulatingSupply,
          totalSupply: tokenData.totalSupply,
          dilutionRisk: this.calculateDilutionRisk(tokenData)
        },
        security: {
          isAudited: tokenData.isAudited,
          auditors: tokenData.auditors || [],
          hasMultisig: tokenData.hasMultisig,
          exploits: tokenData.knownExploits || 0
        },
        community: {
          twitterFollowers: tokenData.twitterFollowers,
          discordMembers: tokenData.discordMembers,
          communityGrowth: tokenData.communityGrowth,
          sentiment: tokenData.sentiment
        },
        links: {
          website: tokenData.website,
          twitter: tokenData.twitter,
          discord: tokenData.discord,
          contract: this.getContractLink(tokenData.contract, chain)
        }
      };
      
      // Cache result
      this.tokenDatabase.set(key, {
        data: info,
        timestamp: Date.now()
      });
      
      return info;
    } catch (err) {
      this.logger.warn(`Failed to fetch token info for ${tokenSymbol}`, { error: err.message });
      return null;
    }
  }
  
  /**
   * Calculate trust score (0-100)
   */
  calculateTrustScore(tokenData) {
    let score = 50; // Base score
    
    // Security factors
    if (tokenData.isAudited) score += 15;
    if (tokenData.hasMultisig) score += 10;
    if (tokenData.knownExploits === 0) score += 10;
    
    // Market factors
    if (tokenData.marketCap > 100000000) score += 10; // >$100M
    if (tokenData.volume24h > 10000000) score += 5; // >$10M volume
    
    // Community factors
    if (tokenData.twitterFollowers > 50000) score += 10;
    if (tokenData.discordMembers > 10000) score += 5;
    
    // Penalize red flags
    if (tokenData.communityGrowth < -20) score -= 10; // Declining community
    if (tokenData.sentiment < -0.5) score -= 15; // Negative sentiment
    
    return Math.min(100, Math.max(0, score));
  }
  
  /**
   * Assess risk level
   */
  assessRisk(trustScore) {
    if (trustScore >= 80) return 'low';
    if (trustScore >= 60) return 'medium';
    if (trustScore >= 40) return 'high';
    return 'extreme';
  }
  
  /**
   * Calculate dilution risk
   */
  calculateDilutionRisk(tokenData) {
    const circulation = tokenData.circulatingSupply || 1;
    const total = tokenData.totalSupply || 1;
    
    const percentage = (circulation / total) * 100;
    
    if (percentage > 90) return 'low';
    if (percentage > 70) return 'medium';
    if (percentage > 50) return 'high';
    return 'extreme';
  }
  
  /**
   * Get contract verification link
   */
  getContractLink(contract, chain) {
    const explorers = {
      ethereum: `https://etherscan.io/token/${contract}`,
      polygon: `https://polygonscan.com/token/${contract}`,
      bsc: `https://bscscan.com/token/${contract}`,
      arbitrum: `https://arbiscan.io/token/${contract}`,
      solana: `https://solscan.io/token/${contract}`,
      avalanche: `https://snowtrace.io/token/${contract}`
    };
    
    return explorers[chain] || null;
  }
  
  /**
   * Fetch token data (from multiple sources)
   */
  async fetchTokenData(tokenSymbol, chain) {
    // Placeholder: In production, would fetch from:
    // - CoinGecko API
    // - Etherscan/explorers
    // - DuneAnalytics
    // - Messari
    
    return {
      name: tokenSymbol.toUpperCase(),
      symbol: tokenSymbol,
      contract: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      launchDate: new Date().toISOString(),
      price: 0.5,
      marketCap: 50000000,
      volume24h: 5000000,
      circulatingSupply: 100000000,
      totalSupply: 1000000000,
      isAudited: false,
      auditors: [],
      hasMultisig: true,
      knownExploits: 0,
      twitterFollowers: 5000,
      discordMembers: 2000,
      communityGrowth: 15,
      sentiment: 0.3,
      website: null,
      twitter: null,
      discord: null
    };
  }
  
  /**
   * Compare tokens
   */
  async compareTokens(tokens) {
    const comparisons = [];
    
    for (const tokenSymbol of tokens) {
      const info = await this.getTokenInfo(tokenSymbol);
      if (info) {
        comparisons.push({
          symbol: info.symbol,
          trustScore: info.trustScore,
          marketCap: info.marketData.marketCap,
          volume24h: info.marketData.volume24h,
          riskLevel: info.riskLevel,
          sentiment: info.community.sentiment
        });
      }
    }
    
    // Sort by trust score
    comparisons.sort((a, b) => b.trustScore - a.trustScore);
    
    return comparisons;
  }
  
  /**
   * Get tokens by category
   */
  async getTokensByCategory(category) {
    const categoryMap = {
      'stablecoin': ['USDC', 'DAI', 'USDT', 'FRAX'],
      'layer2': ['ARB', 'OP', 'SCROLL', 'LINEA'],
      'lending': ['AAVE', 'COMP', 'MAKER'],
      'dex': ['UNI', 'CRV', 'GMX', 'BALANCER'],
      'ai': ['RENDER', 'FET', 'AGIX'],
      'rwa': ['ONDO', 'PROPY', 'KYC3']
    };
    
    const tokens = categoryMap[category] || [];
    return this.compareTokens(tokens);
  }
  
  /**
   * Get hot tokens (trending)
   */
  async getHotTokens(limit = 10) {
    // Would fetch from trending data
    return [];
  }
  
  /**
   * Search tokens
   */
  async search(query) {
    const results = [];
    
    for (const [key, cached] of this.tokenDatabase) {
      const token = cached.data;
      
      if (
        token.symbol.toLowerCase().includes(query.toLowerCase()) ||
        token.name.toLowerCase().includes(query.toLowerCase())
      ) {
        results.push(token);
      }
    }
    
    return results;
  }
  
  /**
   * Get safety checklist
   */
  getSafetyChecklist(tokenInfo) {
    return [
      {
        item: 'Contract Verified',
        status: tokenInfo.security.isAudited ? 'pass' : 'fail'
      },
      {
        item: 'Multisig Wallet',
        status: tokenInfo.security.hasMultisig ? 'pass' : 'warning'
      },
      {
        item: 'Known Exploits',
        status: tokenInfo.security.exploits === 0 ? 'pass' : 'fail'
      },
      {
        item: 'Market Cap >$50M',
        status: tokenInfo.marketData.marketCap > 50000000 ? 'pass' : 'warning'
      },
      {
        item: 'Positive Sentiment',
        status: tokenInfo.community.sentiment > 0 ? 'pass' : 'warning'
      },
      {
        item: 'No Red Flags',
        status: tokenInfo.riskLevel !== 'extreme' ? 'pass' : 'fail'
      }
    ];
  }
  
  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: '1.0.0',
      type: 'token_hub',
      capabilities: [
        'token_info',
        'trust_scoring',
        'risk_assessment',
        'token_comparison',
        'category_filtering',
        'trend_detection'
      ],
      cachedTokens: this.tokenDatabase.size,
      updateFrequency: 'hourly'
    };
  }
}

module.exports = Web3TokenHub;
