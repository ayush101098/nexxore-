/**
 * Crypto News API - Real data from multiple sources
 * Sources: CryptoPanic (free), CoinGecko news, DeFiLlama news
 */

const APIS = {
  CRYPTOPANIC: 'https://cryptopanic.com/api/v1/posts/',
  COINGECKO_NEWS: 'https://api.coingecko.com/api/v3/news',
  DEFILLAMA_NEWS: 'https://api.llama.fi/news'
};

// Protocol keywords for tagging
const PROTOCOL_KEYWORDS = {
  'aave': ['aave', 'aave v3', 'aave protocol'],
  'uniswap': ['uniswap', 'uni', 'uniswap v4', 'uniswap labs'],
  'curve': ['curve', 'crv', 'curve finance'],
  'lido': ['lido', 'steth', 'lido finance', 'lido dao'],
  'maker': ['maker', 'mkr', 'makerdao', 'dai'],
  'compound': ['compound', 'comp'],
  'ethereum': ['ethereum', 'eth', 'vitalik'],
  'bitcoin': ['bitcoin', 'btc', 'satoshi'],
  'solana': ['solana', 'sol'],
  'arbitrum': ['arbitrum', 'arb'],
  'optimism': ['optimism', 'op'],
  'polygon': ['polygon', 'matic']
};

// Simple sentiment analysis based on keywords
function analyzeSentiment(text) {
  const positive = ['bullish', 'surge', 'gain', 'rise', 'growth', 'partnership', 'launch', 'upgrade', 'record', 'adoption', 'breakthrough', 'milestone'];
  const negative = ['bearish', 'crash', 'dump', 'hack', 'exploit', 'vulnerability', 'sec', 'lawsuit', 'decline', 'risk', 'warning', 'scam'];
  
  const lower = (text || '').toLowerCase();
  let score = 0;
  
  positive.forEach(word => { if (lower.includes(word)) score += 0.15; });
  negative.forEach(word => { if (lower.includes(word)) score -= 0.15; });
  
  return Math.max(-1, Math.min(1, score));
}

// Extract mentioned protocols from text
function extractProtocols(text) {
  const lower = (text || '').toLowerCase();
  const found = [];
  
  Object.entries(PROTOCOL_KEYWORDS).forEach(([protocol, keywords]) => {
    if (keywords.some(kw => lower.includes(kw))) {
      found.push(protocol.toUpperCase());
    }
  });
  
  return [...new Set(found)];
}

// Fetch from CryptoPanic (free, no auth needed for basic)
async function fetchCryptoPanic() {
  try {
    // Public endpoint - limited but works
    const url = `${APIS.CRYPTOPANIC}?auth_token=&public=true&kind=news&filter=hot`;
    const res = await fetch(url, { 
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return (data.results || []).slice(0, 15).map(item => ({
      source: item.source?.title || 'CryptoPanic',
      title: item.title,
      description: item.title, // CryptoPanic doesn't always have description
      url: item.url,
      publishedAt: item.published_at,
      sentiment: analyzeSentiment(item.title),
      protocols: extractProtocols(item.title),
      votes: item.votes || {},
      timestamp: item.published_at
    }));
  } catch (err) {
    console.error('CryptoPanic fetch error:', err.message);
    return [];
  }
}

// Fetch from CoinGecko status updates (acts like news)
async function fetchCoinGeckoUpdates() {
  try {
    const url = 'https://api.coingecko.com/api/v3/status_updates?per_page=20';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return (data.status_updates || []).map(item => ({
      source: item.project?.name || 'CoinGecko',
      title: item.description?.substring(0, 100) + '...',
      description: item.description,
      url: item.project?.links?.homepage?.[0] || '#',
      publishedAt: item.created_at,
      sentiment: analyzeSentiment(item.description),
      protocols: extractProtocols(item.description),
      category: item.category,
      timestamp: item.created_at
    }));
  } catch (err) {
    console.error('CoinGecko updates error:', err.message);
    return [];
  }
}

// Fetch DeFi-specific news from DeFiLlama
async function fetchDeFiLlamaNews() {
  try {
    // DeFiLlama doesn't have a direct news API, but we can fetch protocol changes
    const url = 'https://api.llama.fi/protocols';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!res.ok) return [];
    
    const protocols = await res.json();
    
    // Find protocols with significant recent changes (simulates "news")
    const significant = protocols
      .filter(p => p.change_1d && Math.abs(p.change_1d) > 10)
      .slice(0, 10)
      .map(p => ({
        source: 'DeFiLlama',
        title: `${p.name}: ${p.change_1d > 0 ? '+' : ''}${p.change_1d.toFixed(1)}% TVL change in 24h`,
        description: `${p.name} TVL is now $${formatNumber(p.tvl)}. ${p.change_1d > 0 ? 'Significant inflows detected.' : 'Notable outflows observed.'}`,
        url: `https://defillama.com/protocol/${p.slug}`,
        publishedAt: new Date().toISOString(),
        sentiment: p.change_1d > 0 ? 0.5 : -0.3,
        protocols: [p.symbol?.toUpperCase()].filter(Boolean),
        category: 'TVL Movement',
        timestamp: new Date().toISOString()
      }));
    
    return significant;
  } catch (err) {
    console.error('DeFiLlama news error:', err.message);
    return [];
  }
}

// Fetch from RSS feeds (fallback)
async function fetchRSSNews() {
  try {
    // Using a free RSS-to-JSON service
    const feeds = [
      'https://api.rss2json.com/v1/api.json?rss_url=https://cointelegraph.com/rss',
      'https://api.rss2json.com/v1/api.json?rss_url=https://thedefiant.io/feed'
    ];
    
    const results = await Promise.allSettled(
      feeds.map(url => 
        fetch(url, { signal: AbortSignal.timeout(8000) })
          .then(r => r.ok ? r.json() : null)
      )
    );
    
    const news = [];
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value?.items) {
        result.value.items.slice(0, 8).forEach(item => {
          news.push({
            source: result.value.feed?.title || 'RSS Feed',
            title: item.title,
            description: item.description?.replace(/<[^>]*>/g, '').substring(0, 200),
            url: item.link,
            publishedAt: item.pubDate,
            sentiment: analyzeSentiment(item.title + ' ' + item.description),
            protocols: extractProtocols(item.title + ' ' + item.description),
            timestamp: item.pubDate
          });
        });
      }
    });
    
    return news;
  } catch (err) {
    console.error('RSS fetch error:', err.message);
    return [];
  }
}

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num?.toFixed(2) || '0';
}

async function fetchAllNews() {
  console.log('📰 Fetching news from multiple sources...');
  
  // Fetch from all sources in parallel
  const [cryptoPanic, coinGecko, defiLlama, rss] = await Promise.allSettled([
    fetchCryptoPanic(),
    fetchCoinGeckoUpdates(),
    fetchDeFiLlamaNews(),
    fetchRSSNews()
  ]);
  
  const allNews = [];
  
  if (cryptoPanic.status === 'fulfilled') allNews.push(...cryptoPanic.value);
  if (coinGecko.status === 'fulfilled') allNews.push(...coinGecko.value);
  if (defiLlama.status === 'fulfilled') allNews.push(...defiLlama.value);
  if (rss.status === 'fulfilled') allNews.push(...rss.value);
  
  // Sort by date and deduplicate by title similarity
  const seen = new Set();
  const unique = allNews
    .filter(item => {
      const key = item.title?.toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 25);
  
  console.log(`📰 Fetched ${unique.length} unique news items`);
  return unique;
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
    const news = await fetchAllNews();
    res.status(200).json({ 
      news,
      sources: ['CryptoPanic', 'CoinGecko', 'DeFiLlama', 'RSS Feeds'],
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: err.message, news: [] });
  }
};
