async function fetchTrendingTokens() {
  // Return mock trending data for now
  return [
    {
      name: 'Bitcoin',
      symbol: 'BTC',
      market_cap_rank: 1,
      sparkline: 'https://www.coingecko.com/coins/1/sparkline'
    },
    {
      name: 'Ethereum',
      symbol: 'ETH',
      market_cap_rank: 2,
      sparkline: 'https://www.coingecko.com/coins/279/sparkline'
    },
    {
      name: 'Solana',
      symbol: 'SOL',
      market_cap_rank: 5,
      sparkline: 'https://www.coingecko.com/coins/5426/sparkline'
    },
    {
      name: 'Chainlink',
      symbol: 'LINK',
      market_cap_rank: 12,
      sparkline: 'https://www.coingecko.com/coins/1975/sparkline'
    },
    {
      name: 'Avalanche',
      symbol: 'AVAX',
      market_cap_rank: 11,
      sparkline: 'https://www.coingecko.com/coins/5805/sparkline'
    },
    {
      name: 'Polygon',
      symbol: 'MATIC',
      market_cap_rank: 15,
      sparkline: 'https://www.coingecko.com/coins/4713/sparkline'
    },
    {
      name: 'Uniswap',
      symbol: 'UNI',
      market_cap_rank: 18,
      sparkline: 'https://www.coingecko.com/coins/7083/sparkline'
    },
    {
      name: 'Aave',
      symbol: 'AAVE',
      market_cap_rank: 45,
      sparkline: 'https://www.coingecko.com/coins/7278/sparkline'
    },
    {
      name: 'Curve DAO',
      symbol: 'CRV',
      market_cap_rank: 87,
      sparkline: 'https://www.coingecko.com/coins/6538/sparkline'
    },
    {
      name: 'Compound',
      symbol: 'COMP',
      market_cap_rank: 125,
      sparkline: 'https://www.coingecko.com/coins/5692/sparkline'
    }
  ];
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
