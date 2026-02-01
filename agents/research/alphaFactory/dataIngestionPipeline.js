const EventEmitter = require('events');

// Optional dependencies (only used if installed + configured)
let RedisClient = null;
let PgClient = null;
let WebSocketImpl = null;
try { RedisClient = require('redis'); } catch (_) {}
try { PgClient = require('pg'); } catch (_) {}
try { WebSocketImpl = require('ws'); } catch (_) {}

const DEFAULT_TIMEOUT_MS = 12000;

class RateLimiter {
  constructor({ calls = 60, windowMs = 60000 } = {}) {
    this.calls = calls;
    this.windowMs = windowMs;
    this.queue = [];
    this.timestamps = [];
    this.timer = null;
  }

  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.timer) return;
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

    if (this.queue.length === 0) return;

    if (this.timestamps.length < this.calls) {
      const item = this.queue.shift();
      this.timestamps.push(now);
      Promise.resolve()
        .then(item.fn)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => this._drain());
    } else {
      const wait = this.windowMs - (now - this.timestamps[0]);
      this.timer = setTimeout(() => {
        this.timer = null;
        this._drain();
      }, Math.max(25, wait));
    }
  }
}

class CacheLayer {
  constructor() {
    this.memory = new Map();
    this.redis = null;
    this.ready = false;
  }

  async init(redisUrl) {
    if (!RedisClient || !redisUrl) return;
    this.redis = RedisClient.createClient({ url: redisUrl });
    this.redis.on('error', () => {});
    await this.redis.connect();
    this.ready = true;
  }

  _isExpired(entry) {
    return entry && entry.expiresAt && Date.now() > entry.expiresAt;
  }

  async get(key) {
    const mem = this.memory.get(key);
    if (mem && !this._isExpired(mem)) return mem.value;
    if (mem && this._isExpired(mem)) this.memory.delete(key);

    if (this.ready && this.redis) {
      const data = await this.redis.get(key);
      if (data) return JSON.parse(data);
    }
    return null;
  }

  async set(key, value, ttlMs = 60000) {
    const expiresAt = Date.now() + ttlMs;
    this.memory.set(key, { value, expiresAt });
    if (this.ready && this.redis) {
      await this.redis.set(key, JSON.stringify(value), { PX: ttlMs });
    }
  }
}

class HistoricalStore {
  constructor() {
    this.client = null;
  }

  async init(pgUrl) {
    if (!PgClient || !pgUrl) return;
    this.client = new PgClient.Client({ connectionString: pgUrl });
    await this.client.connect();
    await this.client.query(
      `CREATE TABLE IF NOT EXISTS research_raw_events (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        asset TEXT,
        payload JSONB NOT NULL,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
  }

  async write(source, asset, payload) {
    if (!this.client) return;
    await this.client.query(
      'INSERT INTO research_raw_events (source, asset, payload) VALUES ($1, $2, $3)',
      [source, asset || null, payload]
    );
  }
}

class AlphaFactoryIngestionPipeline extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      cookieFunApiKey: process.env.COOKIE_FUN_API_KEY,
      twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
      coinMarketCapKey: process.env.COINMARKETCAP_API_KEY,
      redisUrl: process.env.REDIS_URL,
      postgresUrl: process.env.POSTGRES_URL,
      maxTwitterAccounts: 200,
      ...config
    };

    this.rateLimiters = {
      cookieFun: new RateLimiter({ calls: 60, windowMs: 60000 }),
      twitter: new RateLimiter({ calls: 150, windowMs: 900000 }),
      binance: new RateLimiter({ calls: 120, windowMs: 60000 }),
      coinbase: new RateLimiter({ calls: 60, windowMs: 60000 }),
      hyperliquid: new RateLimiter({ calls: 60, windowMs: 60000 }),
      coingecko: new RateLimiter({ calls: 50, windowMs: 60000 }),
      cmc: new RateLimiter({ calls: 30, windowMs: 60000 }),
      dydx: new RateLimiter({ calls: 60, windowMs: 60000 }),
      gmx: new RateLimiter({ calls: 60, windowMs: 60000 }),
      bybit: new RateLimiter({ calls: 60, windowMs: 60000 }),
      okx: new RateLimiter({ calls: 60, windowMs: 60000 }),
      defillama: new RateLimiter({ calls: 120, windowMs: 60000 })
    };

    this.cache = new CacheLayer();
    this.store = new HistoricalStore();
    this.priceFeeds = {
      binance: null,
      coinbase: null,
      hyperliquid: null
    };

    this.latestOHLCV = new Map();
  }

  async init() {
    await this.cache.init(this.config.redisUrl);
    await this.store.init(this.config.postgresUrl);
  }

  // ---------- Utilities ----------
  normalizeTimestamp(ts) {
    const date = ts ? new Date(ts) : new Date();
    return date.toISOString();
  }

  normalizeAssetSymbol(symbol, marketType = 'spot') {
    const base = (symbol || '').toUpperCase().replace(/-?PERP/i, '').replace('USDT', '').replace('USD', '');
    return { base, marketType };
  }

  removeOutliers(values = [], zThreshold = 4) {
    if (values.length < 5) return values;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance || 1);
    return values.filter(v => Math.abs((v - mean) / std) <= zThreshold);
  }

  validateTimestampSequence(series = []) {
    for (let i = 1; i < series.length; i++) {
      if (new Date(series[i]).getTime() < new Date(series[i - 1]).getTime()) return false;
    }
    return true;
  }

  isStale(ts, maxAgeMs = 5 * 60 * 1000) {
    return Date.now() - new Date(ts).getTime() > maxAgeMs;
  }

  async fetchWithBackoff(fn, { retries = 3, baseDelay = 500 } = {}) {
    let lastError;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw lastError;
  }

  async fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, rateLimiter, method = 'GET', body } = {}) {
    const execute = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { headers, method, body, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return res.json();
    };

    if (rateLimiter) return rateLimiter.schedule(() => this.fetchWithBackoff(execute));
    return this.fetchWithBackoff(execute);
  }

  async fetchWithFallback(primaryFn, fallbackFn) {
    try {
      return await primaryFn();
    } catch (_) {
      return fallbackFn ? fallbackFn() : null;
    }
  }

  // ---------- Cookie.fun ----------
  async fetchCookieTrending() {
    const cacheKey = 'cookiefun:trending';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const apiKey = this.config.cookieFunApiKey;
    if (!apiKey) return [];

    const url = 'https://api.cookie.fun/v1/trending';
    const data = await this.fetchJson(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      rateLimiter: this.rateLimiters.cookieFun
    });

    const normalized = (data?.data || []).map(item => {
      const norm = this.normalizeAssetSymbol(item.symbol || item.ticker || '');
      return {
        asset: norm.base,
        marketType: norm.marketType,
        narrative: item.narrative || item.tags || [],
        velocity: item.velocity || item.tokensPerHour || 0,
        mentions: item.mentions || 0,
        timestamp: this.normalizeTimestamp(item.timestamp || Date.now())
      };
    });

    await this.cache.set(cacheKey, normalized, 60000);
    await this.store.write('cookiefun', null, normalized);
    return normalized;
  }

  // ---------- Twitter/X ----------
  async fetchTwitterMentions(accounts = []) {
    const list = accounts.slice(0, this.config.maxTwitterAccounts);
    if (!this.config.twitterBearerToken || list.length === 0) return [];

    const url = `https://api.twitter.com/2/tweets/search/recent?query=from:${list.join(' OR from:')}&tweet.fields=created_at,public_metrics,entities&expansions=author_id&user.fields=username`;
    const data = await this.fetchJson(url, {
      headers: { 'Authorization': `Bearer ${this.config.twitterBearerToken}` },
      rateLimiter: this.rateLimiters.twitter
    });

    const users = new Map((data?.includes?.users || []).map(u => [u.id, u.username]));
    const tweets = (data?.data || []).map(t => ({
      id: t.id,
      text: t.text,
      engagement: t.public_metrics || {},
      entities: t.entities || {},
      author: users.get(t.author_id) || t.author_id,
      timestamp: this.normalizeTimestamp(t.created_at)
    }));

    await this.store.write('twitter', null, tweets);
    return tweets;
  }

  // ---------- Price Feeds (WS) ----------
  connectPriceFeeds() {
    if (!WebSocketImpl) return;

    // Binance stream
    const binanceStream = 'wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m/solusdt@kline_1m';
    this.priceFeeds.binance = new WebSocketImpl(binanceStream);
    this.priceFeeds.binance.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const k = msg?.data?.k;
      if (!k) return;
      const symbol = (k.s || '').replace('USDT', '');
      const norm = this.normalizeAssetSymbol(symbol, 'perp');
      this.latestOHLCV.set(norm.base, {
        source: 'binance',
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        timestamp: this.normalizeTimestamp(k.T)
      });
    };

    // Coinbase stream
    const coinbase = new WebSocketImpl('wss://ws-feed.exchange.coinbase.com');
    coinbase.onopen = () => {
      coinbase.send(JSON.stringify({
        type: 'subscribe',
        product_ids: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
        channels: ['ticker']
      }));
    };
    coinbase.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'ticker') return;
      const symbol = msg.product_id.replace('-USD', '');
      const norm = this.normalizeAssetSymbol(symbol, 'spot');
      this.latestOHLCV.set(norm.base + '_SPOT', {
        source: 'coinbase',
        open: null,
        high: null,
        low: null,
        close: parseFloat(msg.price),
        volume: parseFloat(msg.volume_24h || 0),
        timestamp: this.normalizeTimestamp(msg.time)
      });
    };
    this.priceFeeds.coinbase = coinbase;

    // Hyperliquid (public WS)
    const hl = new WebSocketImpl('wss://api.hyperliquid.xyz/ws');
    hl.onopen = () => {
      hl.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'ETH' } }));
      hl.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } }));
      hl.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'SOL' } }));
    };
    hl.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg?.channel || msg.channel !== 'l2Book') return;
      const coin = msg?.data?.coin;
      if (!coin) return;
      this.latestOHLCV.set(coin + '_PERP', {
        source: 'hyperliquid',
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
        timestamp: this.normalizeTimestamp(Date.now())
      });
    };
    this.priceFeeds.hyperliquid = hl;
  }

  getLatestOHLCV() {
    return Array.from(this.latestOHLCV.entries()).map(([key, value]) => ({
      asset: key,
      ...value
    }));
  }

  // ---------- Derivatives (OI/Funding) ----------
  async fetchOpenInterestAndFunding() {
    const results = [];

    // dYdX (public markets)
    const dydx = await this.fetchWithFallback(
      () => this.fetchJson('https://api.dydx.exchange/v3/markets', { rateLimiter: this.rateLimiters.dydx }),
      () => ({ markets: {} })
    );

    Object.keys(dydx.markets || {}).forEach(m => {
      results.push({
        source: 'dydx',
        market: m,
        openInterest: parseFloat(dydx.markets[m]?.openInterest || 0),
        fundingRate: parseFloat(dydx.markets[m]?.nextFundingRate || 0),
        timestamp: this.normalizeTimestamp(Date.now())
      });
    });

    // GMX (public stats)
    const gmx = await this.fetchWithFallback(
      () => this.fetchJson('https://gmxstats.com/api/summary', { rateLimiter: this.rateLimiters.gmx }),
      () => ({})
    );

    if (gmx?.openInterest) {
      results.push({
        source: 'gmx',
        market: 'GMX',
        openInterest: parseFloat(gmx.openInterest || 0),
        fundingRate: parseFloat(gmx.fundingRate || 0),
        timestamp: this.normalizeTimestamp(Date.now())
      });
    }

    await this.store.write('derivatives', null, results);
    return results;
  }

  async fetchFundingRatesByExchange(symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    const output = {};

    for (const sym of symbols) {
      const okxInst = sym.replace('USDT', '-USDT-SWAP');
      const binance = await this.fetchWithFallback(
        () => this.fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, { rateLimiter: this.rateLimiters.binance }),
        () => null
      );
      const bybit = await this.fetchWithFallback(
        () => this.fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`, { rateLimiter: this.rateLimiters.bybit }),
        () => null
      );
      const okx = await this.fetchWithFallback(
        () => this.fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${okxInst}`, { rateLimiter: this.rateLimiters.okx }),
        () => null
      );

      const binanceRate = parseFloat(binance?.lastFundingRate || binance?.fundingRate || 0);
      const bybitRate = parseFloat(bybit?.result?.list?.[0]?.fundingRate || 0);
      const okxRate = parseFloat(okx?.data?.[0]?.fundingRate || 0);

      output[sym.replace('USDT', '')] = {
        binance: binanceRate,
        bybit: bybitRate,
        okx: okxRate
      };
    }

    // Hyperliquid funding (optional)
    const hyper = await this.fetchWithFallback(
      () => this.fetchJson('https://api.hyperliquid.xyz/info', {
        rateLimiter: this.rateLimiters.hyperliquid,
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: DEFAULT_TIMEOUT_MS,
        method: 'POST',
        body: JSON.stringify({ type: 'fundingRates' })
      }),
      () => null
    );
    if (hyper?.data || Array.isArray(hyper)) {
      const list = hyper.data || hyper;
      list.forEach(item => {
        const coin = item.coin || item.symbol;
        if (!coin || !output[coin]) return;
        output[coin].hyperliquid = parseFloat(item.fundingRate || item.rate || 0);
      });
    }

    await this.store.write('funding', null, output);
    return output;
  }

  async fetchOpenInterestByExchange(symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    const output = {};

    for (const sym of symbols) {
      const okxInst = sym.replace('USDT', '-USDT-SWAP');
      const binance = await this.fetchWithFallback(
        () => this.fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`, { rateLimiter: this.rateLimiters.binance }),
        () => null
      );
      const bybit = await this.fetchWithFallback(
        () => this.fetchJson(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}`, { rateLimiter: this.rateLimiters.bybit }),
        () => null
      );
      const okx = await this.fetchWithFallback(
        () => this.fetchJson(`https://www.okx.com/api/v5/public/open-interest?instId=${okxInst}`, { rateLimiter: this.rateLimiters.okx }),
        () => null
      );

      const binanceOI = parseFloat(binance?.openInterest || 0);
      const bybitOI = parseFloat(bybit?.result?.list?.[0]?.openInterest || 0);
      const okxOI = parseFloat(okx?.data?.[0]?.openInterest || 0);

      output[sym.replace('USDT', '')] = {
        binance: binanceOI,
        bybit: bybitOI,
        okx: okxOI
      };
    }

    await this.store.write('open_interest', null, output);
    return output;
  }

  // ---------- CEX/DEX Volume ----------
  async fetchVolumeAggregation() {
    const cacheKey = 'volume:aggregate';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const coingecko = await this.fetchWithFallback(
      () => this.fetchJson('https://api.coingecko.com/api/v3/global', { rateLimiter: this.rateLimiters.coingecko }),
      () => null
    );

    const cmc = await this.fetchWithFallback(
      () => this.fetchJson('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest', {
        headers: { 'X-CMC_PRO_API_KEY': this.config.coinMarketCapKey || '' },
        rateLimiter: this.rateLimiters.cmc
      }),
      () => null
    );

    const totalSpot = coingecko?.data?.total_market_cap?.usd || cmc?.data?.quote?.USD?.total_market_cap || 0;
    const totalDerivatives = coingecko?.data?.total_volume?.usd || cmc?.data?.quote?.USD?.total_volume_24h || 0;

    const agg = {
      spotVolumeUsd: totalSpot,
      derivativesVolumeUsd: totalDerivatives,
      timestamp: this.normalizeTimestamp(Date.now())
    };

    await this.cache.set(cacheKey, agg, 60000);
    await this.store.write('volume', null, agg);
    return agg;
  }

  // ---------- On-chain Metrics ----------
  async fetchOnChainMetrics() {
    const cacheKey = 'onchain:metrics';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const stablecoins = await this.fetchWithFallback(
      () => this.fetchJson('https://stablecoins.llama.fi/stablecoins', { rateLimiter: this.rateLimiters.defillama }),
      () => null
    );

    const dexOverview = await this.fetchWithFallback(
      () => this.fetchJson('https://api.llama.fi/overview/dexs', { rateLimiter: this.rateLimiters.defillama }),
      () => null
    );

    const bridgeOverview = await this.fetchWithFallback(
      () => this.fetchJson('https://bridges.llama.fi/bridgevolume/all', { rateLimiter: this.rateLimiters.defillama }),
      () => null
    );

    const totalStablecoin = Array.isArray(stablecoins?.peggedAssets)
      ? stablecoins.peggedAssets.reduce((s, a) => s + (a.circulating?.usd || a.circulating || 0), 0)
      : 0;

    const dexVolume = Array.isArray(dexOverview?.totalDataChart)
      ? dexOverview.totalDataChart[dexOverview.totalDataChart.length - 1]?.[1] || 0
      : 0;

    const dexPrev = Array.isArray(dexOverview?.totalDataChart)
      ? dexOverview.totalDataChart[dexOverview.totalDataChart.length - 2]?.[1] || 0
      : 0;

    const bridgeVolume = Array.isArray(bridgeOverview?.totalDataChart)
      ? bridgeOverview.totalDataChart[bridgeOverview.totalDataChart.length - 1]?.[1] || 0
      : 0;

    const stablecoinNetflowUsd = 0; // Placeholder (requires time-series)
    const dexVolumeChange = dexPrev ? ((dexVolume - dexPrev) / dexPrev) * 100 : 0;

    const metrics = {
      activeAddresses24h: 0,
      activeAddressGrowth: 0,
      txVolumeUsd: 0,
      whaleNetflow: 0,
      exchangeNetflow: 0,
      dexVolumeUsd: dexVolume,
      dexVolumeChange,
      stablecoinNetflowUsd,
      bridgeVolumeUsd: bridgeVolume,
      gasPriceGwei: 0,
      top10HolderPct: 0,
      totalStablecoinUsd: totalStablecoin
    };

    await this.cache.set(cacheKey, metrics, 60000);
    await this.store.write('onchain', null, metrics);
    return metrics;
  }

  // ---------- Pipeline ----------
  async fetchSnapshot({ twitterAccounts = [] } = {}) {
    const [cookie, twitter, derivatives, volume, fundingRates, openInterest, onchain] = await Promise.all([
      this.fetchCookieTrending(),
      this.fetchTwitterMentions(twitterAccounts),
      this.fetchOpenInterestAndFunding(),
      this.fetchVolumeAggregation(),
      this.fetchFundingRatesByExchange(),
      this.fetchOpenInterestByExchange(),
      this.fetchOnChainMetrics()
    ]);

    const snapshot = {
      timestamp: this.normalizeTimestamp(Date.now()),
      cookie,
      twitter,
      derivatives,
      volume,
      fundingRates,
      openInterest,
      onchain,
      priceFeeds: this.getLatestOHLCV()
    };

    // Data quality checks
    snapshot.dataQuality = {
      cookieStale: cookie?.length ? this.isStale(cookie[0]?.timestamp) : true,
      twitterStale: twitter?.length ? this.isStale(twitter[0]?.timestamp) : true
    };

    return snapshot;
  }
}

module.exports = { AlphaFactoryIngestionPipeline };
