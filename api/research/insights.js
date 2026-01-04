/**
 * Protocol Insights API - Real data from DeFiLlama, CoinGecko
 * Comprehensive protocol analysis with TVL, yields, price data
 */

const APIS = {
  DEFILLAMA_PROTOCOL: 'https://api.llama.fi/protocol',
  DEFILLAMA_TVL: 'https://api.llama.fi/tvl',
  DEFILLAMA_YIELDS: 'https://yields.llama.fi/pools',
  COINGECKO_COIN: 'https://api.coingecko.com/api/v3/coins',
  COINGECKO_MARKETS: 'https://api.coingecko.com/api/v3/coins/markets'
};

// Protocol mappings for CoinGecko IDs
const PROTOCOL_COINGECKO_IDS = {
  'aave': 'aave',
  'curve': 'curve-dao-token',
  'uniswap': 'uniswap',
  'lido': 'lido-dao',
  'maker': 'maker',
  'compound': 'compound-governance-token',
  'convex': 'convex-finance',
  'gmx': 'gmx',
  'pendle': 'pendle',
  'eigenlayer': 'eigenlayer',
  'ethena': 'ethena',
  'morpho': 'morpho',
  'pancakeswap': 'pancakeswap-token',
  'sushiswap': 'sushi',
  'balancer': 'balancer',
  'yearn': 'yearn-finance',
  'instadapp': 'instadapp',
  'rocket-pool': 'rocket-pool',
  'frax': 'frax-share'
};

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Fetch comprehensive TVL data from DeFiLlama
async function fetchProtocolTVL(protocolSlug) {
  try {
    const url = `${APIS.DEFILLAMA_PROTOCOL}/${protocolSlug}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const tvlHistory = data.tvl || [];
    const chainTvls = data.chainTvls || {};
    
    // Current TVL
    const currentTvl = data.currentChainTvls 
      ? Object.values(data.currentChainTvls).reduce((a, b) => a + b, 0)
      : tvlHistory[tvlHistory.length - 1]?.totalLiquidityUSD || 0;
    
    // Calculate changes
    let tvlChange1d = 0, tvlChange7d = 0, tvlChange30d = 0;
    
    if (tvlHistory.length >= 2) {
      const yesterday = tvlHistory[tvlHistory.length - 2]?.totalLiquidityUSD || 0;
      if (yesterday > 0) tvlChange1d = ((currentTvl - yesterday) / yesterday) * 100;
    }
    
    if (tvlHistory.length >= 8) {
      const weekAgo = tvlHistory[tvlHistory.length - 8]?.totalLiquidityUSD || 0;
      if (weekAgo > 0) tvlChange7d = ((currentTvl - weekAgo) / weekAgo) * 100;
    }
    
    if (tvlHistory.length >= 31) {
      const monthAgo = tvlHistory[tvlHistory.length - 31]?.totalLiquidityUSD || 0;
      if (monthAgo > 0) tvlChange30d = ((currentTvl - monthAgo) / monthAgo) * 100;
    }
    
    // Get chain breakdown
    const chains = Object.entries(data.currentChainTvls || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([chain, tvl]) => ({ chain, tvl, percentage: (tvl / currentTvl * 100).toFixed(1) }));
    
    return {
      tvl: currentTvl,
      tvlChange1d,
      tvlChange7d,
      tvlChange30d,
      category: data.category,
      chains: data.chains || [],
      chainBreakdown: chains,
      mcap: data.mcap,
      url: data.url,
      twitter: data.twitter,
      gecko_id: data.gecko_id
    };
  } catch (err) {
    console.error(`TVL fetch error for ${protocolSlug}:`, err.message);
    return null;
  }
}

// Fetch token price data from CoinGecko
async function fetchTokenData(coingeckoId) {
  try {
    const url = `${APIS.COINGECKO_COIN}/${coingeckoId}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=true`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    
    return {
      price: data.market_data?.current_price?.usd,
      priceChange24h: data.market_data?.price_change_percentage_24h,
      priceChange7d: data.market_data?.price_change_percentage_7d,
      priceChange30d: data.market_data?.price_change_percentage_30d,
      marketCap: data.market_data?.market_cap?.usd,
      marketCapRank: data.market_cap_rank,
      volume24h: data.market_data?.total_volume?.usd,
      ath: data.market_data?.ath?.usd,
      athDate: data.market_data?.ath_date?.usd,
      athChangePercentage: data.market_data?.ath_change_percentage?.usd,
      circulatingSupply: data.market_data?.circulating_supply,
      totalSupply: data.market_data?.total_supply,
      fdv: data.market_data?.fully_diluted_valuation?.usd,
      sparkline: data.market_data?.sparkline_7d?.price || [],
      // Developer activity
      devScore: data.developer_score,
      commits4Weeks: data.developer_data?.commit_count_4_weeks,
      forks: data.developer_data?.forks,
      stars: data.developer_data?.stars,
      // Community
      twitterFollowers: data.community_data?.twitter_followers,
      telegramUsers: data.community_data?.telegram_channel_user_count,
      redditSubscribers: data.community_data?.reddit_subscribers
    };
  } catch (err) {
    console.error(`Token data fetch error for ${coingeckoId}:`, err.message);
    return null;
  }
}

// Fetch yield data for protocol
async function fetchProtocolYields(protocolSlug) {
  try {
    const res = await fetch(APIS.DEFILLAMA_YIELDS, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    const pools = (data.data || [])
      .filter(pool => pool.project?.toLowerCase() === protocolSlug.toLowerCase())
      .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
      .slice(0, 10)
      .map(pool => ({
        pool: pool.pool,
        symbol: pool.symbol,
        chain: pool.chain,
        apy: pool.apy,
        apyBase: pool.apyBase,
        apyReward: pool.apyReward,
        tvl: pool.tvlUsd,
        ilRisk: pool.ilRisk,
        stablecoin: pool.stablecoin,
        exposure: pool.exposure
      }));
    
    return pools;
  } catch (err) {
    console.error(`Yield fetch error for ${protocolSlug}:`, err.message);
    return [];
  }
}

// Analyze protocol and generate insights
async function analyzeProtocol(protocolSlug) {
  console.log(`🔍 Analyzing protocol: ${protocolSlug}`);
  
  const coingeckoId = PROTOCOL_COINGECKO_IDS[protocolSlug.toLowerCase()] || protocolSlug;
  
  // Fetch all data in parallel
  const [tvlData, tokenData, yields] = await Promise.allSettled([
    fetchProtocolTVL(protocolSlug),
    fetchTokenData(coingeckoId),
    fetchProtocolYields(protocolSlug)
  ]);
  
  const tvl = tvlData.status === 'fulfilled' ? tvlData.value : null;
  const token = tokenData.status === 'fulfilled' ? tokenData.value : null;
  const yieldPools = yields.status === 'fulfilled' ? yields.value : [];
  
  if (!tvl && !token) {
    return {
      protocol: protocolSlug,
      success: false,
      error: 'Failed to fetch data from any source'
    };
  }
  
  // Generate insights
  const insights = [];
  
  // TVL insights
  if (tvl) {
    if (tvl.tvlChange7d > 10) {
      insights.push({
        type: 'BULLISH',
        category: 'TVL',
        message: `Strong TVL growth: +${tvl.tvlChange7d.toFixed(1)}% in 7 days`,
        impact: 'high'
      });
    } else if (tvl.tvlChange7d < -10) {
      insights.push({
        type: 'BEARISH',
        category: 'TVL',
        message: `TVL declining: ${tvl.tvlChange7d.toFixed(1)}% in 7 days`,
        impact: 'high'
      });
    }
    
    if (tvl.tvlChange1d > 5) {
      insights.push({
        type: 'ALERT',
        category: 'TVL',
        message: `Unusual 24h inflow: +${tvl.tvlChange1d.toFixed(1)}%`,
        impact: 'medium'
      });
    }
  }
  
  // Price vs TVL divergence
  if (tvl && token) {
    const tvlGrowth = tvl.tvlChange7d || 0;
    const priceGrowth = token.priceChange7d || 0;
    const divergence = tvlGrowth - priceGrowth;
    
    if (divergence > 15) {
      insights.push({
        type: 'OPPORTUNITY',
        category: 'DIVERGENCE',
        message: `TVL growing faster than price (+${divergence.toFixed(1)}% divergence) - potential undervaluation`,
        impact: 'high'
      });
    } else if (divergence < -15) {
      insights.push({
        type: 'WARNING',
        category: 'DIVERGENCE',
        message: `Price rising faster than TVL - potential overvaluation`,
        impact: 'medium'
      });
    }
  }
  
  // Yield insights
  if (yieldPools.length > 0) {
    const highYield = yieldPools.find(p => p.apy > 20);
    if (highYield) {
      insights.push({
        type: 'YIELD',
        category: 'OPPORTUNITY',
        message: `High yield available: ${highYield.symbol} at ${highYield.apy.toFixed(1)}% APY`,
        impact: 'medium',
        pool: highYield
      });
    }
    
    const avgApy = yieldPools.reduce((sum, p) => sum + (p.apy || 0), 0) / yieldPools.length;
    if (avgApy > 15) {
      insights.push({
        type: 'INFO',
        category: 'YIELD',
        message: `Average pool APY: ${avgApy.toFixed(1)}%`,
        impact: 'low'
      });
    }
  }
  
  // Dev activity insights
  if (token?.commits4Weeks > 100) {
    insights.push({
      type: 'BULLISH',
      category: 'DEVELOPMENT',
      message: `High dev activity: ${token.commits4Weeks} commits in last 4 weeks`,
      impact: 'medium'
    });
  }
  
  // Calculate confidence score
  let confidence = 0;
  if (tvl) confidence += 0.3;
  if (token) confidence += 0.3;
  if (yieldPools.length > 0) confidence += 0.2;
  if (insights.length > 0) confidence += 0.2;
  
  // Generate summary
  let summary = `${protocolSlug.toUpperCase()}: `;
  if (tvl) {
    summary += `TVL $${formatNumber(tvl.tvl)} (${tvl.tvlChange7d > 0 ? '+' : ''}${tvl.tvlChange7d.toFixed(1)}% 7d)`;
  }
  if (token) {
    summary += ` | Price $${token.price?.toFixed(2)} (${token.priceChange7d > 0 ? '+' : ''}${token.priceChange7d?.toFixed(1)}% 7d)`;
  }
  
  return {
    protocol: protocolSlug,
    success: true,
    tvl: tvl ? {
      current: tvl.tvl,
      change1d: tvl.tvlChange1d,
      change7d: tvl.tvlChange7d,
      change30d: tvl.tvlChange30d,
      category: tvl.category,
      chains: tvl.chains,
      chainBreakdown: tvl.chainBreakdown
    } : null,
    token: token ? {
      price: token.price,
      priceChange24h: token.priceChange24h,
      priceChange7d: token.priceChange7d,
      priceChange30d: token.priceChange30d,
      marketCap: token.marketCap,
      marketCapRank: token.marketCapRank,
      volume24h: token.volume24h,
      fdv: token.fdv,
      sparkline: token.sparkline
    } : null,
    yields: yieldPools,
    devActivity: token ? {
      commits4Weeks: token.commits4Weeks,
      forks: token.forks,
      stars: token.stars,
      devScore: token.devScore
    } : null,
    community: token ? {
      twitter: token.twitterFollowers,
      telegram: token.telegramUsers,
      reddit: token.redditSubscribers
    } : null,
    insights,
    summary,
    confidence,
    timestamp: new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const protocols = req.query.protocols || 'aave,uniswap,lido,curve,maker';
    const protocolList = protocols.split(',').map(p => p.trim().toLowerCase());
    
    console.log('🔍 Analyzing protocols:', protocolList);
    
    const results = await Promise.all(
      protocolList.map(protocol => analyzeProtocol(protocol))
    );
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Analyzed ${successful.length}/${results.length} protocols successfully`);
    
    res.status(200).json({ 
      insights: successful,
      failed: failed.map(f => ({ protocol: f.protocol, error: f.error })),
      sources: ['DeFiLlama', 'CoinGecko'],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error generating research insights:', err);
    res.status(500).json({ error: err.message, insights: [] });
  }
};
