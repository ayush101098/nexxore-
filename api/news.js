// Simple news fetcher without external dependencies
async function fetchCryptoNews() {
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  
  // Return mock data if no API key
  if (!NEWS_API_KEY) {
    return [
      {
        source: 'CoinDesk',
        title: 'AAVE Introduces Flash Loan Enhancements',
        description: 'AAVE protocol announces major updates to flash loan functionality...',
        url: '#',
        sentiment: 0.7,
        protocols: ['AAVE'],
        publishedAt: new Date(Date.now() - 2*60*60*1000).toISOString(),
        timestamp: new Date(Date.now() - 2*60*60*1000).toISOString()
      },
      {
        source: 'CoinTelegraph',
        title: 'Curve Finance Partners with Major Stablecoin Issuer',
        description: 'Curve Finance reaches partnership agreement...',
        url: '#',
        sentiment: 0.6,
        protocols: ['CURVE'],
        publishedAt: new Date(Date.now() - 4*60*60*1000).toISOString(),
        timestamp: new Date(Date.now() - 4*60*60*1000).toISOString()
      },
      {
        source: 'The Block',
        title: 'Uniswap V4 Beta Launch Imminent',
        description: 'Uniswap core team signals imminent launch of V4...',
        url: '#',
        sentiment: 0.8,
        protocols: ['UNI'],
        publishedAt: new Date(Date.now() - 6*60*60*1000).toISOString(),
        timestamp: new Date(Date.now() - 6*60*60*1000).toISOString()
      }
    ];
  }
  
  try {
    const query = 'crypto OR defi OR ethereum';
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=en&pageSize=20&apiKey=${NEWS_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`NewsAPI error: ${response.status}`);
    }
    
    const data = await response.json();
    return (data.articles || []).map(article => ({
      source: article.source?.name || 'Unknown',
      title: article.title,
      description: article.description,
      url: article.url,
      imageUrl: article.urlToImage,
      publishedAt: article.publishedAt,
      sentiment: 0,
      protocols: [],
      timestamp: new Date(article.publishedAt).toISOString()
    }));
  } catch (err) {
    console.error('News fetch error:', err);
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const news = await fetchCryptoNews();
    res.status(200).json({ news });
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: err.message, news: [] });
  }
};
