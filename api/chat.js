/**
 * AI Chat API — Context-Aware DeFi Intelligence Engine
 * ═══════════════════════════════════════════════════════
 * 
 * Queries live data from DeFi Llama, CoinGecko, and other real sources
 * to give data-backed answers about protocols, yields, markets, stablecoins.
 *
 * POST /api/chat  { message: "..." }
 * GET  /api/chat?q=...  (for testing)
 */

const DEFILLAMA_BASE = 'https://api.llama.fi';
const YIELDS_BASE = 'https://yields.llama.fi';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const STABLECOINS_BASE = 'https://stablecoins.llama.fi';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.data;
  return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

async function fetchJSON(url, cacheKey) {
  const c = getCached(cacheKey || url);
  if (c) return c;
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    setCache(cacheKey || url, d);
    return d;
  } catch (e) {
    console.error(`Fetch error ${url}:`, e.message);
    return null;
  }
}

function formatUSD(val) {
  if (!val || isNaN(val)) return '$0';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

// ═══════════════════════════════════════════════════════════
//  INTENT DETECTION
// ═══════════════════════════════════════════════════════════

function detectIntent(message) {
  const lower = message.toLowerCase();
  const intents = [];
  const protocolNames = ['aave','compound','uniswap','curve','lido','maker','morpho','pendle',
    'eigenlayer','ethena','convex','yearn','sushi','balancer','gmx','dydx','synthetix',
    'pancakeswap','raydium','jupiter','marinade','jito','rocket pool','beefy','sommelier',
    'gearbox','instadapp','spark','venus','benqi','trader joe','camelot'];
  const mentioned = protocolNames.filter(p => lower.includes(p));
  if (mentioned.length > 0) intents.push({ type: 'protocol', protocols: mentioned });
  if (/yield|apy|apr|earn|farm|best.*return|highest.*rate|where.*earn/i.test(lower)) intents.push({ type: 'yield' });
  if (/market|overview|tvl|total.*locked|defi.*state|how.*market|bull|bear|sentiment/i.test(lower)) intents.push({ type: 'market' });
  if (/stablecoin|stable.*coin|usdc|usdt|dai|frax|peg|depeg|tether/i.test(lower)) intents.push({ type: 'stablecoin' });
  if (/price|bitcoin|btc|eth|ethereum|sol|solana|worth|cost/i.test(lower)) intents.push({ type: 'price' });
  if (/strateg|allocat|portfolio|invest|where.*put|what.*buy|risk|conservative|aggressive/i.test(lower)) intents.push({ type: 'strategy' });
  if (/chain|arbitrum|optimism|polygon|base|avalanche|bsc|layer.*2|l2/i.test(lower)) intents.push({ type: 'chain' });
  if (/vault|deposit|withdraw|safe.*yield|advanced.*realloc/i.test(lower)) intents.push({ type: 'vault' });
  if (/perp|perpetual|leverage|long|short|fund.*rate|liquidat/i.test(lower)) intents.push({ type: 'perps' });
  if (intents.length === 0) intents.push({ type: 'general' });
  return intents;
}

// ═══════════════════════════════════════════════════════════
//  DATA FETCHERS
// ═══════════════════════════════════════════════════════════

async function getProtocolInfo(names) {
  const protocols = await fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'chat_protocols');
  if (!protocols) return null;
  return names.map(name => {
    const nl = name.toLowerCase();
    // Try exact match first, then slug, then partial name/slug match
    const p = protocols.find(pr => pr.name.toLowerCase() === nl || (pr.slug || '').toLowerCase() === nl)
           || protocols.find(pr => pr.name.toLowerCase().includes(nl) || (pr.slug || '').toLowerCase().includes(nl));
    if (!p) return { name, found: false };
    return { name: p.name, found: true, tvl: p.tvl, tvlF: formatUSD(p.tvl), d1: p.change_1d, d7: p.change_7d, chains: p.chains || [], category: p.category, mcap: p.mcap };
  });
}

async function getYieldInfo() {
  const pools = await fetchJSON(`${YIELDS_BASE}/pools`, 'chat_pools');
  if (!pools?.data) return null;
  const topStable = pools.data.filter(p => p.stablecoin && p.tvlUsd > 10_000_000 && p.apy > 0).sort((a, b) => b.apy - a.apy).slice(0, 5);
  const topAll = pools.data.filter(p => p.tvlUsd > 5_000_000 && p.apy > 0 && p.apy < 100).sort((a, b) => b.apy - a.apy).slice(0, 5);
  return { topStable, topAll };
}

async function getMarketInfo() {
  const [fng, prices] = await Promise.all([
    fetchJSON('https://api.alternative.me/fng/?limit=1', 'chat_fng'),
    fetchJSON(`${COINGECKO_BASE}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, 'chat_prices')
  ]);
  return { fng: fng?.data?.[0] || { value: 50, value_classification: 'Neutral' }, prices: prices || {} };
}

// ═══════════════════════════════════════════════════════════
//  RESPONSE BUILDER
// ═══════════════════════════════════════════════════════════

async function buildResponse(intents, message) {
  const sections = [];
  const dataSources = [];

  for (const intent of intents) {
    switch (intent.type) {
      case 'protocol': {
        const data = await getProtocolInfo(intent.protocols);
        if (data) {
          data.forEach(p => {
            if (p.found) sections.push(`**${p.name}**: TVL ${p.tvlF} (${(p.d1||0)>0?'+':''}${(p.d1||0).toFixed(1)}% 24h). Category: ${p.category}. Chains: ${p.chains.slice(0,5).join(', ')}.${p.mcap ? ` MCap: ${formatUSD(p.mcap)}` : ''}`);
            else sections.push(`Couldn't find data for "${p.name}".`);
          });
          dataSources.push('DeFi Llama');
        }
        break;
      }
      case 'yield': {
        const data = await getYieldInfo();
        if (data) {
          sections.push('**🔥 Top Stablecoin Yields:**');
          data.topStable.forEach((p,i) => sections.push(`${i+1}. **${p.symbol}** on ${p.project} (${p.chain}): ${p.apy.toFixed(2)}% APY — ${formatUSD(p.tvlUsd)} TVL`));
          sections.push('\n**💎 Top Overall Yields:**');
          data.topAll.forEach((p,i) => sections.push(`${i+1}. **${p.symbol}** on ${p.project} (${p.chain}): ${p.apy.toFixed(2)}% APY`));
          dataSources.push('DeFi Llama yields');
        }
        break;
      }
      case 'market': {
        const data = await getMarketInfo();
        if (data) {
          const fv = data.fng.value;
          const sent = fv<25?'🔴 Extreme Fear':fv<45?'🟠 Fear':fv<55?'⚪ Neutral':fv<75?'🟢 Greed':'🟢 Extreme Greed';
          sections.push(`**📊 Market Overview:**\nFear & Greed: **${fv}/100** (${sent})`);
          if (data.prices.bitcoin?.usd) sections.push(`BTC: **$${data.prices.bitcoin.usd.toLocaleString()}** (${(data.prices.bitcoin.usd_24h_change||0).toFixed(1)}% 24h)`);
          if (data.prices.ethereum?.usd) sections.push(`ETH: **$${data.prices.ethereum.usd.toLocaleString()}** (${(data.prices.ethereum.usd_24h_change||0).toFixed(1)}% 24h)`);
          if (data.prices.solana?.usd) sections.push(`SOL: **$${data.prices.solana.usd.toLocaleString()}** (${(data.prices.solana.usd_24h_change||0).toFixed(1)}% 24h)`);
          dataSources.push('CoinGecko', 'Alternative.me');
        }
        break;
      }
      case 'stablecoin': {
        const stables = await fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'chat_stables');
        if (stables?.peggedAssets) {
          const top = stables.peggedAssets.filter(a=>(a.circulating?.peggedUSD||0)>100_000_000).sort((a,b)=>(b.circulating?.peggedUSD||0)-(a.circulating?.peggedUSD||0)).slice(0,8);
          sections.push('**🏦 Stablecoin Market:**');
          top.forEach(s => {
            const mcap = s.circulating?.peggedUSD||0;
            const dev = Math.abs((s.price||1)-1)*100;
            sections.push(`${dev<0.1?'✅':dev<0.5?'⚠️':'🔴'} **${s.symbol}**: ${formatUSD(mcap)} — $${(s.price||1).toFixed(4)} (${dev<0.01?'on peg':dev.toFixed(3)+'% dev'})`);
          });
          dataSources.push('DeFi Llama stablecoins');
        }
        break;
      }
      case 'price': {
        const tokenMap = {'btc':'bitcoin','bitcoin':'bitcoin','eth':'ethereum','ethereum':'ethereum','sol':'solana','solana':'solana','bnb':'binancecoin','avax':'avalanche-2','link':'chainlink','uni':'uniswap','aave':'aave','mkr':'maker','crv':'curve-dao-token','ldo':'lido-dao','pendle':'pendle'};
        const refs = message.toLowerCase().match(/\b(btc|bitcoin|eth|ethereum|sol|solana|bnb|avax|link|uni|aave|mkr|crv|ldo|pendle)\b/g) || ['bitcoin','ethereum'];
        const ids = [...new Set(refs)].map(t => tokenMap[t]||t).join(',');
        const data = await fetchJSON(`${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, `chat_p_${ids}`);
        if (data) {
          sections.push('**💰 Prices:**');
          Object.entries(data).forEach(([id,d]) => sections.push(`**${id}**: $${d.usd?.toLocaleString()} (${(d.usd_24h_change||0)>0?'+':''}${(d.usd_24h_change||0).toFixed(2)}% 24h)`));
          dataSources.push('CoinGecko');
        }
        break;
      }
      case 'strategy': {
        const [market, yields] = await Promise.all([getMarketInfo(), getYieldInfo()]);
        if (market && yields) {
          const fv = market.fng.value;
          const profile = fv<30 ? {n:'Conservative (Fear)',s:'60-70%',e:'20-25%',y:'10-15%'} : fv>70 ? {n:'Cautious (Greed)',s:'40-50%',e:'30-35%',y:'20-25%'} : {n:'Balanced',s:'40-50%',e:'25-30%',y:'20-30%'};
          sections.push(`**📋 Suggested Strategy (FnG: ${fv}):**\nProfile: **${profile.n}**`);
          sections.push(`• Stablecoins: ${profile.s} — Top: ${yields.topStable[0]?.apy.toFixed(1)}% on ${yields.topStable[0]?.project}`);
          sections.push(`• ETH/BTC: ${profile.e}\n• Active Yield: ${profile.y}`);
          sections.push(`*Data-informed, not financial advice.*`);
          dataSources.push('DeFi Llama', 'Alternative.me');
        }
        break;
      }
      case 'vault':
        sections.push(`**🏛 Nexxore Vaults:**\n• **Safe Yield** — Low risk, stablecoin strategies. Target 5-12% APY.\n• **Advanced Realloc** — Active optimization. Target 12-25% APY.\nVisit the Vaults page for live data.`);
        break;
      case 'perps':
        sections.push(`**📈 Perps Trading:**\nReal-time HyperLiquid integration with orderbook, candles, funding rates, and position tracking. Visit the Perps page.`);
        break;
      case 'chain': {
        const chains = await fetchJSON(`${DEFILLAMA_BASE}/v2/chains`, 'chat_chains');
        if (chains) {
          const top = chains.sort((a,b)=>(b.tvl||0)-(a.tvl||0)).slice(0,8);
          sections.push('**🔗 Top Chains by TVL:**');
          top.forEach((c,i) => sections.push(`${i+1}. **${c.name}**: ${formatUSD(c.tvl)}`));
          dataSources.push('DeFi Llama');
        }
        break;
      }
      default:
        sections.push(`I'm Nexxore's DeFi assistant. Ask me about:\n• **Protocols** — "Tell me about Aave"\n• **Yields** — "Best stablecoin yields"\n• **Market** — "How's the market?"\n• **Stablecoins** — "Are stablecoins pegged?"\n• **Prices** — "ETH price"\n• **Strategy** — "What should I invest in?"\n\nAll answers use live data from DeFi Llama + CoinGecko.`);
    }
  }

  return { response: sections.join('\n'), dataSources: [...new Set(dataSources)], intents: intents.map(i=>i.type), timestamp: Date.now() };
}

// ═══════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let message;
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    message = url.searchParams.get('message') || url.searchParams.get('q');
  } else {
    message = req.body?.message;
  }

  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const intents = detectIntent(message);
    const result = await buildResponse(intents, message);
    res.status(200).json(result);
  } catch (err) {
    console.error('Chat API error:', err);
    res.status(500).json({ error: err.message, response: 'Sorry, I had trouble fetching live data. Please try again.' });
  }
};
