/**
 * Trending Tokens API - Real data from CoinGecko & CoinMarketCap
 * Fetches actual trending tokens, top gainers, and market movers
 */

const APIS = {
  COINGECKO_TRENDING: 'https://api.coingecko.com/api/v3/search/trending',
  COINGECKO_MARKETS: 'https://api.coingecko.com/api/v3/coins/markets',
  COINGECKO_GLOBAL: 'https://api.coingecko.com/api/v3/global',
  CMC_TRENDING: 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/spotlight'
};

// Fetch CoinGecko trending (actual trending searches)
async function fetchCoinGeckoTrending() {
  try {
    const res = await fetch(APIS.COINGECKO_TRENDING, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) {
      console.error('CoinGecko trending error:', res.status);
      return [];
    }
    
    const data = await res.json();
    return (data.coins || []).map(item => ({
      id: item.item.id,
      name: item.item.name,
      symbol: item.item.symbol,
      market_cap_rank: item.item.market_cap_rank,
      thumb: item.item.thumb,
      large: item.item.large,
      price_btc: item.item.price_btc,
      score: item.item.score,
      source: 'coingecko_trending'
    }));
  } catch (err) {
    console.error('CoinGecko trending fetch error:', err.message);
    return [];
  }
}

// Fetch top gainers from CoinGecko markets
async function fetchTopGainers() {
  try {
    const url = `${APIS.COINGECKO_MARKETS}?vs_currency=usd&order=price_change_percentage_24h_desc&per_page=15&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.filter(coin => coin.price_change_percentage_24h > 0).map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      market_cap_rank: coin.market_cap_rank,
      current_price: coin.current_price,
      price_change_24h: coin.price_change_percentage_24h,
      price_change_7d: coin.price_change_percentage_7d_in_currency,
      market_cap: coin.market_cap,
      volume_24h: coin.total_volume,
      sparkline: coin.sparkline_in_7d?.price || [],
      image: coin.image,
      source: 'top_gainer'
    }));
  } catch (err) {
    console.error('Top gainers fetch error:', err.message);
    return [];
  }
}

// Fetch top losers
async function fetchTopLosers() {
  try {
    const url = `${APIS.COINGECKO_MARKETS}?vs_currency=usd&order=price_change_percentage_24h_asc&per_page=10&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.filter(coin => coin.price_change_percentage_24h < 0).map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      market_cap_rank: coin.market_cap_rank,
      current_price: coin.current_price,
      price_change_24h: coin.price_change_percentage_24h,
      price_change_7d: coin.price_change_percentage_7d_in_currency,
      market_cap: coin.market_cap,
      volume_24h: coin.total_volume,
      sparkline: coin.sparkline_in_7d?.price || [],
      image: coin.image,
      source: 'top_loser'
    }));
  } catch (err) {
    console.error('Top losers fetch error:', err.message);
    return [];
  }
}

// Fetch high volume tokens (unusual activity)
async function fetchHighVolume() {
  try {
    const url = `${APIS.COINGECKO_MARKETS}?vs_currency=usd&order=volume_desc&per_page=20&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    
    // Calculate volume/market_cap ratio to find unusual volume
    return data
      .map(coin => ({
        ...coin,
        volumeToMcap: coin.total_volume / coin.market_cap
      }))
      .filter(coin => coin.volumeToMcap > 0.15) // Volume > 15% of mcap is notable
      .slice(0, 10)
      .map(coin => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
        market_cap_rank: coin.market_cap_rank,
        current_price: coin.current_price,
        price_change_24h: coin.price_change_percentage_24h,
        market_cap: coin.market_cap,
        volume_24h: coin.total_volume,
        volume_to_mcap: (coin.volumeToMcap * 100).toFixed(1) + '%',
        sparkline: coin.sparkline_in_7d?.price || [],
        image: coin.image,
        source: 'high_volume'
      }));
  } catch (err) {
    console.error('High volume fetch error:', err.message);
    return [];
  }
}

// Fetch DeFi-specific trending from DeFiLlama
async function fetchDeFiTrending() {
  try {
    const url = 'https://api.llama.fi/protocols';
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    
    if (!res.ok) return [];
    
    const protocols = await res.json();
    
    // Sort by 7d change to find trending DeFi protocols
    return protocols
      .filter(p => p.change_7d && p.tvl > 10000000) // >$10M TVL
      .sort((a, b) => (b.change_7d || 0) - (a.change_7d || 0))
      .slice(0, 10)
      .map(p => ({
        id: p.slug,
        name: p.name,
        symbol: p.symbol || p.name.substring(0, 4).toUpperCase(),
        category: p.category,
        tvl: p.tvl,
        tvl_change_24h: p.change_1d,
        tvl_change_7d: p.change_7d,
        chains: p.chains,
        url: p.url,
        source: 'defi_trending'
      }));
  } catch (err) {
    console.error('DeFi trending fetch error:', err.message);
    return [];
  }
}

// Fetch global market data
async function fetchGlobalData() {
  try {
    const res = await fetch(APIS.COINGECKO_GLOBAL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    return {
      total_market_cap: data.data?.total_market_cap?.usd,
      total_volume: data.data?.total_volume?.usd,
      btc_dominance: data.data?.market_cap_percentage?.btc,
      eth_dominance: data.data?.market_cap_percentage?.eth,
      market_cap_change_24h: data.data?.market_cap_change_percentage_24h_usd,
      active_cryptocurrencies: data.data?.active_cryptocurrencies
    };
  } catch (err) {
    console.error('Global data fetch error:', err.message);
    return null;
  }
}

async function fetchAllTrending() {
  console.log('📈 Fetching trending data from multiple sources...');
  
  const [trending, gainers, losers, highVolume, defi, global] = await Promise.allSettled([
    fetchCoinGeckoTrending(),
    fetchTopGainers(),
    fetchTopLosers(),
    fetchHighVolume(),
    fetchDeFiTrending(),
    fetchGlobalData()
  ]);
  
  const result = {
    trending: trending.status === 'fulfilled' ? trending.value : [],
    gainers: gainers.status === 'fulfilled' ? gainers.value : [],
    losers: losers.status === 'fulfilled' ? losers.value : [],
    highVolume: highVolume.status === 'fulfilled' ? highVolume.value : [],
    defiTrending: defi.status === 'fulfilled' ? defi.value : [],
    global: global.status === 'fulfilled' ? global.value : null
  };
  
  // Create combined trending list for backwards compatibility
  const combined = [
    ...result.trending.slice(0, 7),
    ...result.gainers.slice(0, 5),
    ...result.defiTrending.slice(0, 3)
  ];
  
  console.log(`📈 Fetched: ${result.trending.length} trending, ${result.gainers.length} gainers, ${result.defiTrending.length} DeFi`);
  
  return {
    ...result,
    combined,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const data = await fetchAllTrending();
    
    // Support both new format and legacy format
    res.status(200).json({ 
      trending: data.combined, // Legacy support
      ...data,
      sources: ['CoinGecko Trending', 'CoinGecko Markets', 'DeFiLlama']
    });
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.status(500).json({ error: err.message, trending: [] });
  }
};
