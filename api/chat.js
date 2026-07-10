/**
 * Nexxore AI — crypto & DeFi research assistant (Claude-powered)
 * ═══════════════════════════════════════════════════════════════
 *
 * A real LLM (Claude Opus 4.8) that answers anything crypto: protocol research
 * end-to-end, trade relations & macro, token/market questions, yields, risk.
 * Grounded with live DeFiLlama / CoinGecko data and Claude's web-search tool so
 * answers reflect current on-chain state, not stale training data.
 *
 * POST /api/chat  { message: "...", history?: [{role, content}, ...] }
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8'; // swap to claude-haiku-4-5 / claude-sonnet-5 for a cheaper public endpoint
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

// ── intent detection: decides which live data to attach as grounding ──
function detectIntent(message) {
  const lower = message.toLowerCase();
  const intents = new Set();
  const protocolNames = ['aave','compound','uniswap','curve','lido','maker','morpho','pendle',
    'eigenlayer','ethena','convex','yearn','sushi','balancer','gmx','dydx','synthetix',
    'pancakeswap','raydium','jupiter','marinade','jito','rocket pool','beefy','sommelier',
    'gearbox','instadapp','spark','venus','benqi','trader joe','camelot','hyperliquid'];
  const mentioned = protocolNames.filter(p => lower.includes(p));
  if (mentioned.length) intents.add('protocol:' + mentioned.slice(0, 4).join(','));
  if (/yield|apy|apr|earn|farm|best.*return|highest.*rate/.test(lower)) intents.add('yield');
  if (/market|overview|tvl|total.*locked|defi.*state|bull|bear|sentiment|fear|greed/.test(lower)) intents.add('market');
  if (/stablecoin|usdc|usdt|dai|frax|peg|depeg|tether/.test(lower)) intents.add('stablecoin');
  if (/price|bitcoin|\bbtc\b|\beth\b|ethereum|\bsol\b|solana|worth/.test(lower)) intents.add('price');
  if (/\bchain\b|arbitrum|optimism|polygon|base|avalanche|\bbsc\b|layer.*2|\bl2\b/.test(lower)) intents.add('chain');
  return intents;
}

async function getProtocolInfo(names) {
  const protocols = await fetchJSON(`${DEFILLAMA_BASE}/protocols`, 'chat_protocols');
  if (!protocols) return null;
  return names.map(name => {
    const nl = name.toLowerCase();
    const p = protocols.find(pr => pr.name.toLowerCase() === nl || (pr.slug || '').toLowerCase() === nl)
           || protocols.find(pr => pr.name.toLowerCase().includes(nl) || (pr.slug || '').toLowerCase().includes(nl));
    if (!p) return `${name}: not found on DeFiLlama`;
    return `${p.name}: TVL ${formatUSD(p.tvl)} (${(p.change_1d || 0) > 0 ? '+' : ''}${(p.change_1d || 0).toFixed(1)}% 24h, ${(p.change_7d || 0).toFixed(1)}% 7d), category ${p.category}, chains ${(p.chains || []).slice(0, 6).join('/')}${p.mcap ? `, mcap ${formatUSD(p.mcap)}` : ''}`;
  }).join('\n');
}

async function buildGrounding(message) {
  const intents = detectIntent(message);
  const blocks = [];
  const sources = new Set();
  const jobs = [];

  for (const intent of intents) {
    if (intent.startsWith('protocol:')) {
      const names = intent.slice(9).split(',');
      jobs.push(getProtocolInfo(names).then(t => { if (t) { blocks.push('PROTOCOLS (DeFiLlama):\n' + t); sources.add('DeFiLlama'); } }));
    } else if (intent === 'yield') {
      jobs.push(fetchJSON(`${YIELDS_BASE}/pools`, 'chat_pools').then(pools => {
        if (!pools?.data) return;
        const stable = pools.data.filter(p => p.stablecoin && p.tvlUsd > 10e6 && p.apy > 0).sort((a, b) => b.apy - a.apy).slice(0, 6);
        const all = pools.data.filter(p => p.tvlUsd > 5e6 && p.apy > 0 && p.apy < 100).sort((a, b) => b.apy - a.apy).slice(0, 6);
        blocks.push('TOP STABLE YIELDS:\n' + stable.map(p => `${p.symbol} on ${p.project} (${p.chain}): ${p.apy.toFixed(2)}% APY, ${formatUSD(p.tvlUsd)} TVL`).join('\n') +
          '\nTOP OVERALL YIELDS:\n' + all.map(p => `${p.symbol} on ${p.project} (${p.chain}): ${p.apy.toFixed(2)}% APY`).join('\n'));
        sources.add('DeFiLlama Yields');
      }));
    } else if (intent === 'market' || intent === 'price') {
      jobs.push(Promise.all([
        fetchJSON('https://api.alternative.me/fng/?limit=1', 'chat_fng'),
        fetchJSON(`${COINGECKO_BASE}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, 'chat_prices')
      ]).then(([fng, prices]) => {
        const f = fng?.data?.[0];
        const p = prices || {};
        const line = [];
        if (f) line.push(`Fear & Greed: ${f.value}/100 (${f.value_classification})`);
        if (p.bitcoin?.usd) line.push(`BTC $${p.bitcoin.usd.toLocaleString()} (${(p.bitcoin.usd_24h_change || 0).toFixed(1)}% 24h)`);
        if (p.ethereum?.usd) line.push(`ETH $${p.ethereum.usd.toLocaleString()} (${(p.ethereum.usd_24h_change || 0).toFixed(1)}% 24h)`);
        if (p.solana?.usd) line.push(`SOL $${p.solana.usd.toLocaleString()} (${(p.solana.usd_24h_change || 0).toFixed(1)}% 24h)`);
        if (line.length) { blocks.push('MARKET SNAPSHOT:\n' + line.join('\n')); sources.add('CoinGecko'); sources.add('Alternative.me'); }
      }));
    } else if (intent === 'stablecoin') {
      jobs.push(fetchJSON(`${STABLECOINS_BASE}/stablecoins?includePrices=true`, 'chat_stables').then(s => {
        if (!s?.peggedAssets) return;
        const top = s.peggedAssets.filter(a => (a.circulating?.peggedUSD || 0) > 100e6).sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0)).slice(0, 8);
        blocks.push('STABLECOINS:\n' + top.map(a => `${a.symbol}: ${formatUSD(a.circulating?.peggedUSD || 0)} cap, $${(a.price || 1).toFixed(4)} (${(Math.abs((a.price || 1) - 1) * 100).toFixed(3)}% off peg)`).join('\n'));
        sources.add('DeFiLlama Stablecoins');
      }));
    } else if (intent === 'chain') {
      jobs.push(fetchJSON(`${DEFILLAMA_BASE}/v2/chains`, 'chat_chains').then(chains => {
        if (!chains) return;
        const top = chains.sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 8);
        blocks.push('TOP CHAINS BY TVL:\n' + top.map(c => `${c.name}: ${formatUSD(c.tvl)}`).join('\n'));
        sources.add('DeFiLlama');
      }));
    }
  }

  await Promise.allSettled(jobs);
  return { context: blocks.join('\n\n'), sources: [...sources] };
}

const SYSTEM = `You are Nexxore AI, an expert crypto and DeFi research analyst embedded in the Nexxore intelligence terminal.

You help traders and analysts with:
- Protocol research end-to-end: mechanism design, tokenomics, TVL, revenue, risks, competitive position, recent developments.
- Trade relations & macro: how geopolitics, rates, regulation, and cross-market flows affect crypto.
- Markets & tokens: prices, market structure, on-chain metrics, narratives, catalysts.
- Yields, stablecoins, chains, perps, and risk (liquidation, protocol, smart-contract, depeg).

Guidance:
- When a LIVE DATA block is provided, treat it as ground truth for current numbers and cite it.
- Use web search for anything time-sensitive, recent, or that you're unsure about — never guess at current prices, TVL, or events.
- Be precise and analytical. Lead with the answer, then the reasoning. Use short markdown (bold for key terms, bullet lists) — keep it scannable.
- Give balanced analysis with concrete numbers. Flag risks explicitly.
- You provide research and analysis, not personalized financial advice. Add a one-line "Not financial advice" only when a question asks what to buy/allocate.
- If a question is outside crypto/markets/macro, answer briefly and steer back.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let message, history;
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    message = url.searchParams.get('message') || url.searchParams.get('q');
  } else {
    message = req.body?.message;
    history = req.body?.history;
  }

  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required' });
  message = message.slice(0, 2000);
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI is not configured', response: 'The assistant is not configured yet — ANTHROPIC_API_KEY is missing.' });

  try {
    const client = new Anthropic();
    const { context, sources } = await buildGrounding(message);

    // Prior turns (trimmed) + the current question with live grounding.
    const messages = [];
    if (Array.isArray(history)) {
      history.slice(-6).forEach(m => {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          messages.push({ role: m.role, content: m.content.slice(0, 4000) });
        }
      });
    }
    const userContent = context
      ? `LIVE DATA (fetched now, use for current numbers):\n${context}\n\n---\nQuestion: ${message}`
      : message;
    messages.push({ role: 'user', content: userContent });

    // Server-side web search lets the model research anything current.
    const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }];

    let response, guard = 0;
    do {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools,
        messages,
      });
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
      }
    } while (response.stop_reason === 'pause_turn' && ++guard < 3);

    const searched = response.content.some(b => b.type === 'server_tool_use' || b.type === 'web_search_tool_result');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const allSources = [...sources];
    if (searched) allSources.push('Web search');

    if (response.stop_reason === 'refusal') {
      return res.status(200).json({ response: "I can't help with that one — try a different crypto or markets question.", dataSources: [] });
    }

    res.status(200).json({
      response: text || "I couldn't produce an answer for that — try rephrasing.",
      dataSources: [...new Set(allSources)],
      model: MODEL,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Chat API error:', err);
    const status = err?.status === 429 ? 429 : 500;
    res.status(status).json({
      error: err.message,
      response: status === 429
        ? 'The assistant is busy right now — please try again in a moment.'
        : 'Sorry, I hit an error answering that. Please try again.',
    });
  }
};
