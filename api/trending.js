async function fetchTrendingTokens() {
  try {
    const url = 'https://api.coingecko.com/api/v3/search/trending';
    const response = await fetch(url);
    const data = await response.json();
    
    return data.coins.slice(0, 10).map(coin => ({
      name: coin.item.name,
      symbol: coin.item.symbol.toUpperCase(),
      market_cap_rank: coin.item.market_cap_rank,
      sparkline: coin.item.sparkline
    }));
  } catch (err) {
    console.error('Trending fetch error:', err);
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
    const trending = await fetchTrendingTokens();
    res.status(200).json({ trending });
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.status(500).json({ error: err.message, trending: [] });
  }
};
