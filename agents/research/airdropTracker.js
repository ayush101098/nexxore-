/**
 * Airdrop Intelligence Tracker
 * 
 * Tracks upcoming and active airdrops:
 * - Protocols with confirmed/speculated airdrops
 * - Eligibility criteria & actions
 * - Points programs & farming strategies
 * - Timeline estimates
 */

const DEFILLAMA_BASE = 'https://api.llama.fi';

// Curated airdrop opportunities database
// This is maintained manually but enhanced with live data
const AIRDROP_DATABASE = {
  // High confidence - confirmed or highly likely
  'HIGH_CONFIDENCE': [
    {
      protocol: 'LayerZero',
      ticker: 'ZRO',
      status: 'LIVE', // UPCOMING, LIVE, FARMING, ENDED
      confidence: 95,
      category: 'Infrastructure',
      description: 'Omnichain interoperability protocol. Snapshot taken, claim live.',
      eligibilityCriteria: [
        'Bridge transactions across supported chains',
        'Use LayerZero-enabled dApps (Stargate, Radiant, etc.)',
        'Multi-chain activity preferred'
      ],
      farmingActions: [
        'Bridge on Stargate Finance',
        'Use Radiant Capital cross-chain',
        'Interact with multiple chains'
      ],
      estimatedValue: '$500-$5000',
      timeline: 'Live',
      risk: 'LOW',
      links: {
        website: 'https://layerzero.network',
        docs: 'https://docs.layerzero.network'
      }
    },
    {
      protocol: 'Scroll',
      ticker: 'SCR',
      status: 'LIVE',
      confidence: 100,
      category: 'L2',
      description: 'zkEVM Layer 2. Token launched, farming ongoing.',
      eligibilityCriteria: [
        'Bridge to Scroll',
        'Use Scroll native DeFi',
        'Provide liquidity',
        'Historical activity before snapshot'
      ],
      farmingActions: [
        'Bridge ETH to Scroll',
        'Swap on Ambient/SyncSwap',
        'Provide LP on DEXs',
        'Use lending protocols'
      ],
      estimatedValue: '$200-$2000',
      timeline: 'Ongoing seasons',
      risk: 'LOW',
      links: {
        website: 'https://scroll.io',
        bridge: 'https://scroll.io/bridge'
      }
    },
    {
      protocol: 'Berachain',
      ticker: 'BERA',
      status: 'FARMING',
      confidence: 90,
      category: 'L1',
      description: 'Novel PoL consensus L1. Testnet active, mainnet coming.',
      eligibilityCriteria: [
        'Testnet participation',
        'BGT staking/delegation',
        'Ecosystem dApp usage',
        'NFT holdings (Bong Bears, etc.)'
      ],
      farmingActions: [
        'Get testnet tokens from faucet',
        'Use Berachain DEX & lending',
        'Stake BGT in validators',
        'Participate in governance'
      ],
      estimatedValue: '$1000-$10000',
      timeline: 'Q1 2026 mainnet expected',
      risk: 'MEDIUM',
      links: {
        website: 'https://berachain.com',
        testnet: 'https://artio.faucet.berachain.com'
      }
    },
    {
      protocol: 'Monad',
      ticker: 'MON',
      status: 'FARMING',
      confidence: 85,
      category: 'L1',
      description: 'High-performance EVM L1. Testnet coming soon.',
      eligibilityCriteria: [
        'Discord participation',
        'Testnet activity (when live)',
        'Community engagement',
        'Early ecosystem dApp usage'
      ],
      farmingActions: [
        'Join Discord & engage',
        'Follow social channels',
        'Prepare for testnet launch',
        'Research ecosystem projects'
      ],
      estimatedValue: '$2000-$20000',
      timeline: 'Late 2026',
      risk: 'HIGH',
      links: {
        website: 'https://monad.xyz',
        discord: 'https://discord.gg/monad'
      }
    }
  ],
  
  // Medium confidence - speculated but not confirmed
  'MEDIUM_CONFIDENCE': [
    {
      protocol: 'Hyperliquid',
      ticker: 'HYPE',
      status: 'LIVE',
      confidence: 100,
      category: 'Perp DEX',
      description: 'Leading perp DEX. Points program converted to HYPE.',
      eligibilityCriteria: [
        'Trading volume on platform',
        'Liquidity provision (HLP)',
        'Referral points',
        'Historical activity'
      ],
      farmingActions: [
        'Trade perpetuals',
        'Provide liquidity to HLP vault',
        'Stake HYPE tokens',
        'Use referral system'
      ],
      estimatedValue: 'Variable based on points',
      timeline: 'Ongoing',
      risk: 'MEDIUM',
      links: {
        website: 'https://hyperliquid.xyz',
        app: 'https://app.hyperliquid.xyz'
      }
    },
    {
      protocol: 'Pump.fun',
      ticker: 'PUMP',
      status: 'FARMING',
      confidence: 60,
      category: 'Memecoin Platform',
      description: 'Solana memecoin launchpad. High revenue, no token yet.',
      eligibilityCriteria: [
        'Token creation',
        'Trading activity',
        'Early user status',
        'Volume milestones'
      ],
      farmingActions: [
        'Create tokens on platform',
        'Trade actively',
        'Connect wallet regularly',
        'Use premium features'
      ],
      estimatedValue: 'Unknown - high potential',
      timeline: 'TBD',
      risk: 'HIGH',
      links: {
        website: 'https://pump.fun'
      }
    },
    {
      protocol: 'Phantom',
      ticker: 'PHANTOM',
      status: 'FARMING',
      confidence: 50,
      category: 'Wallet',
      description: 'Leading Solana wallet. Massive user base, no token.',
      eligibilityCriteria: [
        'Wallet usage duration',
        'Transaction count',
        'Multi-chain activity',
        'Swap feature usage'
      ],
      farmingActions: [
        'Use Phantom as primary wallet',
        'Use in-app swaps',
        'Bridge between chains',
        'Stake SOL through app'
      ],
      estimatedValue: 'Unknown',
      timeline: 'TBD',
      risk: 'LOW',
      links: {
        website: 'https://phantom.app'
      }
    },
    {
      protocol: 'Magic Eden',
      ticker: 'ME',
      status: 'LIVE',
      confidence: 100,
      category: 'NFT Marketplace',
      description: 'Multi-chain NFT marketplace. ME token launched.',
      eligibilityCriteria: [
        'NFT trading volume',
        'Collection listings',
        'Diamond rewards participation',
        'Cross-chain activity'
      ],
      farmingActions: [
        'Trade NFTs on platform',
        'List collections',
        'Earn diamonds through activity',
        'Use all supported chains'
      ],
      estimatedValue: '$50-$500',
      timeline: 'Ongoing rewards',
      risk: 'LOW',
      links: {
        website: 'https://magiceden.io'
      }
    }
  ],

  // Points programs - active farming opportunities
  'POINTS_PROGRAMS': [
    {
      protocol: 'EigenLayer',
      program: 'Restaking Points',
      status: 'ACTIVE',
      description: 'Earn points by restaking ETH/LSTs. Season 2 ongoing.',
      apy: '10-20% points value estimate',
      actions: ['Restake ETH', 'Restake LSTs', 'Delegate to operators'],
      risk: 'MEDIUM'
    },
    {
      protocol: 'Ethena',
      program: 'Sats Campaign',
      status: 'ACTIVE',
      description: 'Earn Sats by holding USDe or providing liquidity.',
      apy: '15-30% Sats value estimate',
      actions: ['Hold USDe', 'Stake sUSDe', 'Provide liquidity'],
      risk: 'MEDIUM'
    },
    {
      protocol: 'Pendle',
      program: 'Pendle Points',
      status: 'ACTIVE',
      description: 'Earn points on various pools plus underlying protocol points.',
      apy: 'Variable + stacked points',
      actions: ['LP in points pools', 'Trade YT/PT', 'Lock vePENDLE'],
      risk: 'MEDIUM'
    },
    {
      protocol: 'Symbiotic',
      program: 'Symbiotic Points',
      status: 'ACTIVE',
      description: 'EigenLayer competitor. Early stage points program.',
      apy: '10-25% points estimate',
      actions: ['Deposit collateral', 'Delegate to operators'],
      risk: 'HIGH'
    },
    {
      protocol: 'Karak',
      program: 'XP Program',
      status: 'ACTIVE',
      description: 'Universal restaking platform. XP farming active.',
      apy: '15-30% XP estimate',
      actions: ['Deposit assets', 'Refer friends', 'Complete quests'],
      risk: 'HIGH'
    }
  ]
};

class AirdropTracker {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Get all airdrop opportunities
   */
  async getAllAirdrops() {
    const cacheKey = 'all_airdrops';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      // Enhance with live TVL data
      const enhanced = await this._enhanceWithLiveData();
      
      const result = {
        timestamp: Date.now(),
        highConfidence: enhanced.high,
        mediumConfidence: enhanced.medium,
        pointsPrograms: AIRDROP_DATABASE.POINTS_PROGRAMS,
        summary: this._generateSummary(enhanced)
      };

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;

    } catch (error) {
      console.error('Airdrop fetch error:', error);
      return {
        timestamp: Date.now(),
        highConfidence: AIRDROP_DATABASE.HIGH_CONFIDENCE,
        mediumConfidence: AIRDROP_DATABASE.MEDIUM_CONFIDENCE,
        pointsPrograms: AIRDROP_DATABASE.POINTS_PROGRAMS,
        summary: { total: 0, farming: 0, live: 0 }
      };
    }
  }

  /**
   * Enhance airdrop data with live TVL
   */
  async _enhanceWithLiveData() {
    const enhanceAirdrop = async (airdrop) => {
      try {
        // Try to fetch TVL from DeFiLlama
        const slug = airdrop.protocol.toLowerCase().replace(/\s+/g, '-');
        const response = await fetch(`${DEFILLAMA_BASE}/protocol/${slug}`);
        
        if (response.ok) {
          const data = await response.json();
          return {
            ...airdrop,
            tvl: data.tvl || 0,
            tvlChange: data.change_1d || 0,
            chains: data.chains || []
          };
        }
      } catch (e) {
        // Ignore - return original
      }
      return airdrop;
    };

    const high = await Promise.all(
      AIRDROP_DATABASE.HIGH_CONFIDENCE.map(enhanceAirdrop)
    );
    const medium = await Promise.all(
      AIRDROP_DATABASE.MEDIUM_CONFIDENCE.map(enhanceAirdrop)
    );

    return { high, medium };
  }

  _generateSummary(enhanced) {
    const all = [...enhanced.high, ...enhanced.medium];
    return {
      total: all.length,
      farming: all.filter(a => a.status === 'FARMING').length,
      live: all.filter(a => a.status === 'LIVE').length,
      upcoming: all.filter(a => a.status === 'UPCOMING').length,
      highestPotential: all
        .filter(a => a.estimatedValue.includes('$'))
        .sort((a, b) => {
          const aVal = parseInt(a.estimatedValue.match(/\d+/g)?.pop() || '0');
          const bVal = parseInt(b.estimatedValue.match(/\d+/g)?.pop() || '0');
          return bVal - aVal;
        })
        .slice(0, 3)
        .map(a => a.protocol)
    };
  }

  /**
   * Get airdrops by category
   */
  getByCategory(category) {
    const all = [
      ...AIRDROP_DATABASE.HIGH_CONFIDENCE,
      ...AIRDROP_DATABASE.MEDIUM_CONFIDENCE
    ];
    return all.filter(a => a.category.toLowerCase() === category.toLowerCase());
  }

  /**
   * Get farming-only opportunities
   */
  getFarmingOpportunities() {
    const all = [
      ...AIRDROP_DATABASE.HIGH_CONFIDENCE,
      ...AIRDROP_DATABASE.MEDIUM_CONFIDENCE
    ];
    return {
      airdrops: all.filter(a => a.status === 'FARMING'),
      points: AIRDROP_DATABASE.POINTS_PROGRAMS
    };
  }

  /**
   * Get specific airdrop details
   */
  getAirdropDetails(protocol) {
    const all = [
      ...AIRDROP_DATABASE.HIGH_CONFIDENCE,
      ...AIRDROP_DATABASE.MEDIUM_CONFIDENCE
    ];
    return all.find(a => 
      a.protocol.toLowerCase() === protocol.toLowerCase()
    );
  }
}

module.exports = { AirdropTracker, AIRDROP_DATABASE };
