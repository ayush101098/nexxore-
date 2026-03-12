/* ═══════════════════════════════════════════════════════════
   NEXXORE TERMINAL v4 — WEB WORKER
   Off-main-thread: RSS parsing, sentiment, signals, correlation
   ═══════════════════════════════════════════════════════════ */

// ── Regex patterns (compiled once) ──
const HIGH_RE = /\b(war|crash|fed rate|rate hike|rate cut|sanctions?|default|collapse|surge|plunge|bankrupt|crisis|attack|missile|nuclear|recession|emergency|panic|houthi|blockade|embargo|invasion|coup|liquidat)\b/i;
const MED_RE = /\b(earnings|inflation|GDP|trade deal|merger|acquisition|IPO|unemployment|tariff|stimulus|FOMC|treasury|bond|yield|CPI|shipping|freight|port|canal|pipeline|nifty|sensex|RBI|BOJ|ECB|etf|inflow|outflow)\b/i;
const SHIP_RE = /\b(shipping|freight|vessel|tanker|port|canal|suez|panama|hormuz|malacca|strait|maritime|container|dry bulk|BDI|reroute|piracy|houthi)\b/i;
const BULL_RE = /crypto.*bull|bitcoin.*surge|btc.*rally|rate cut|dovish|stimulus|adoption|etf.*approv|institutional|inflow|halving|upgrade|etf.*flow/i;
const BEAR_RE = /crypto.*crash|bitcoin.*ban|btc.*plunge|rate hike|hawkish|sanctions.*crypto|regulation|hack|exploit|outflow|sell.off|liquidat/i;

function classifyImpact(text) { if (HIGH_RE.test(text)) return 'HIGH'; if (MED_RE.test(text)) return 'MED'; return 'LOW'; }
function classifyCategory(text) {
  const t = text.toLowerCase();
  if (SHIP_RE.test(t)) return 'SHIPPING';
  if (/bitcoin|btc|ethereum|eth|crypto|defi|nft|token|solana|blockchain|binance|coinbase/.test(t)) return 'CRYPTO';
  if (/\bfed\b|fomc|powell|rate hike|rate cut|treasury|central bank|monetary|ecb|boj/.test(t)) return 'FED';
  if (/war|conflict|sanctions|geopolit|military|nato|china.*taiwan|russia|iran|missile|attack|houthi/.test(t)) return 'GEOPOLITICS';
  if (/nifty|sensex|bse|nse|rbi|india|rupee|adani|reliance|tata/.test(t)) return 'INDIA';
  if (/oil|gold|silver|commodity|wheat|corn|natural gas|copper|crude/.test(t)) return 'COMMODITIES';
  return 'MARKETS';
}
function cryptoImpact(text) {
  const t = text.toLowerCase();
  if (BULL_RE.test(t)) return 'bullish';
  if (BEAR_RE.test(t)) return 'bearish';
  return 'neutral';
}

// ── RSS XML Parser ──
function parseRSSXML(xmlString, feedMeta) {
  const items = [];
  // Simple regex-based XML parsing (no DOM in workers)
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xmlString.match(itemRegex) || [];
  
  for (let i = 0; i < Math.min(matches.length, 15); i++) {
    const item = matches[i];
    const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = item.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const dateMatch = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    
    const title = (titleMatch?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const link = (linkMatch?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const pubDate = dateMatch?.[1]?.trim() || new Date().toISOString();
    
    if (!title) continue;
    items.push({
      title, link, pubDate,
      source: feedMeta.name,
      cls: feedMeta.cls,
      category: classifyCategory(title),
      impact: classifyImpact(title),
      cryptoImpact: cryptoImpact(title),
      region: feedMeta.region
    });
  }
  return items;
}

// ── Multi-factor Signal Scoring ──
function computeSignals(data) {
  const { headlines, prices, funding, fng, macro } = data;
  const allText = (headlines || []).join(' ').toLowerCase();
  const signals = [];

  // BTC Signal — multi-factor
  const btcPrice = prices?.BTC?.price || 0;
  const btcChg = prices?.BTC?.chg || 0;
  const btcFund = funding?.BTC || 0;
  const fngVal = fng || 50;
  const dxyChg = macro?.dxyChg || 0;
  const vixVal = macro?.vix || 18;

  let btcScore = 50;
  // ETF flows signal
  if (/etf.*inflow|blackrock.*btc|ibit/i.test(allText)) btcScore += 12;
  if (/etf.*outflow|gbtc.*redemp/i.test(allText)) btcScore -= 12;
  // Funding rate
  if (btcFund > 0.01) btcScore -= 8;
  else if (btcFund < -0.005) btcScore += 8;
  // Fear & Greed contrarian
  if (fngVal <= 20) btcScore += 10;
  else if (fngVal >= 80) btcScore -= 10;
  // DXY inverse
  if (dxyChg > 0.3) btcScore -= 8;
  else if (dxyChg < -0.3) btcScore += 8;
  // VIX fear
  if (vixVal > 30) btcScore -= 10;
  else if (vixVal < 15) btcScore += 5;
  // Headline sentiment
  if (/bitcoin.*surge|btc.*rally|crypto.*bull|etf.*approv|halving/i.test(allText)) btcScore += 10;
  if (/bitcoin.*crash|btc.*plunge|crypto.*sell|bitcoin.*ban/i.test(allText)) btcScore -= 10;
  // 24h change
  btcScore += Math.min(10, Math.max(-10, btcChg * 2));
  // Stablecoin
  if (/usdt.*mint|stablecoin.*supply.*up|tether.*print/i.test(allText)) btcScore += 6;
  // Liquidations
  if (/liquidat.*billion|mass.*liquidat/i.test(allText)) btcScore -= 8;

  btcScore = Math.max(0, Math.min(100, btcScore));
  signals.push({
    asset: 'BTC/USD', price: btcPrice, action: btcScore > 65 ? 'buy' : btcScore < 35 ? 'sell' : 'hold',
    score: btcScore, confidence: Math.min(95, 40 + Math.abs(btcScore - 50) * 1.1),
    timeframe: 'SWING',
    factors: [
      { name: 'Price 24h', val: btcChg.toFixed(2) + '%', impact: btcChg > 0 ? '+' : '-' },
      { name: 'Funding', val: (btcFund * 100).toFixed(3) + '%', impact: btcFund > 0.01 ? '-' : '+' },
      { name: 'F&G', val: fngVal.toString(), impact: fngVal <= 25 ? '+' : fngVal >= 75 ? '-' : '~' },
      { name: 'DXY', val: (dxyChg >= 0 ? '+' : '') + dxyChg.toFixed(2) + '%', impact: dxyChg > 0 ? '-' : '+' },
      { name: 'VIX', val: vixVal.toFixed(1), impact: vixVal > 25 ? '-' : '+' },
      { name: 'Headlines', val: /bull|surge|rally/i.test(allText) ? 'Bullish' : /crash|plunge|sell/i.test(allText) ? 'Bearish' : 'Neutral', impact: /bull|surge/i.test(allText) ? '+' : /crash|plunge/i.test(allText) ? '-' : '~' },
    ],
    drivers: ['DXY ↓ = BTC ↑', 'ETF flows ↑ = BTC ↑', 'Funding neg = BTC ↑', 'VIX ↑ = BTC ↓', 'M2 ↑ = BTC ↑']
  });

  // ETH Signal
  const ethChg = prices?.ETH?.chg || 0;
  let ethScore = 50 + ethChg * 2.5 + (btcScore - 50) * 0.6;
  if (/ethereum.*upgrade|eth.*rally|defi.*growth|l2.*scaling/i.test(allText)) ethScore += 8;
  ethScore = Math.max(0, Math.min(100, ethScore));
  signals.push({
    asset: 'ETH/USD', price: prices?.ETH?.price || 0, action: ethScore > 65 ? 'buy' : ethScore < 35 ? 'sell' : 'hold',
    score: ethScore, confidence: Math.min(90, 38 + Math.abs(ethScore - 50) * 1.1), timeframe: 'SWING',
    factors: [
      { name: 'Price 24h', val: ethChg.toFixed(2) + '%', impact: ethChg > 0 ? '+' : '-' },
      { name: 'BTC Lead', val: btcScore > 50 ? 'Bullish' : 'Bearish', impact: btcScore > 50 ? '+' : '-' },
      { name: 'DeFi', val: /defi.*growth|tvl.*up/i.test(allText) ? 'Growing' : 'Stable', impact: '~' },
    ],
    drivers: ['BTC lead ↑ = ETH ↑', 'DeFi TVL ↑ = ETH ↑', 'Gas ↓ = ETH ↑']
  });

  // SOL Signal
  const solChg = prices?.SOL?.chg || 0;
  let solScore = 50 + solChg * 2 + (btcScore - 50) * 0.7;
  solScore = Math.max(0, Math.min(100, solScore));
  signals.push({
    asset: 'SOL/USD', price: prices?.SOL?.price || 0, action: solScore > 65 ? 'buy' : solScore < 35 ? 'sell' : 'hold',
    score: solScore, confidence: Math.min(88, 35 + Math.abs(solScore - 50) * 1.2), timeframe: 'INTRADAY',
    factors: [
      { name: 'Price 24h', val: solChg.toFixed(2) + '%', impact: solChg > 0 ? '+' : '-' },
      { name: 'BTC Lead', val: btcScore > 50 ? 'Bullish' : 'Bearish', impact: btcScore > 50 ? '+' : '-' },
    ],
    drivers: ['BTC lead ↑ = SOL ↑↑', 'NFT vol ↑ = SOL ↑', 'VC unlock = SOL ↓']
  });

  // NIFTY
  const niftyBull = /nifty.*rally|india.*growth|fpi.*inflow|reliance.*surge/i.test(allText);
  const niftyBear = /nifty.*crash|india.*sell|fpi.*outflow|rbi.*hike/i.test(allText);
  let niftyScore = 50 + (niftyBull ? 15 : 0) - (niftyBear ? 15 : 0);
  niftyScore = Math.max(0, Math.min(100, niftyScore));
  signals.push({
    asset: 'NIFTY 50', price: 23867, action: niftyScore > 60 ? 'buy' : niftyScore < 40 ? 'sell' : 'hold',
    score: niftyScore, confidence: niftyBull || niftyBear ? 72 : 42, timeframe: 'SWING',
    factors: [{ name: 'FPI Flow', val: niftyBull ? 'Inflow' : niftyBear ? 'Outflow' : 'Neutral', impact: niftyBull ? '+' : niftyBear ? '-' : '~' }],
    drivers: ['FPI flows ↑ = Nifty ↑', 'USD/INR ↓ = Nifty ↑', 'Oil ↓ = Nifty ↑', 'RBI cut = Nifty ↑']
  });

  // GOLD
  const goldBull = /gold.*surge|safe.haven|geopolitical.*risk|war|conflict|central.*bank.*buy/i.test(allText);
  signals.push({
    asset: 'GOLD (XAU)', price: 3102, action: goldBull ? 'buy' : 'hold',
    score: goldBull ? 72 : 50, confidence: goldBull ? 82 : 45, timeframe: 'MACRO',
    factors: [{ name: 'Geopolitics', val: goldBull ? 'Risk-On' : 'Stable', impact: goldBull ? '+' : '~' }],
    drivers: ['War/conflict = Gold ↑', 'DXY ↓ = Gold ↑', 'Rate cut = Gold ↑']
  });

  // OIL
  const oilBull = /oil.*surge|opec.*cut|suez.*block|strait.*hormuz|supply.*disrupt/i.test(allText);
  const oilBear = /oil.*crash|demand.*weak|recession|opec.*increase/i.test(allText);
  signals.push({
    asset: 'CRUDE OIL', price: 68.5, action: oilBull ? 'buy' : oilBear ? 'sell' : 'hold',
    score: oilBull ? 72 : oilBear ? 28 : 50, confidence: oilBull ? 78 : oilBear ? 70 : 40, timeframe: 'SWING',
    factors: [{ name: 'Supply', val: oilBull ? 'Disrupted' : 'Balanced', impact: oilBull ? '+' : '~' }],
    drivers: ['Shipping disruption = Oil ↑', 'OPEC cut = Oil ↑', 'Recession = Oil ↓']
  });

  // DXY
  const fedHawk = /fed.*hike|rate.*increase|hawkish|inflation.*high/i.test(allText);
  const fedDove = /fed.*cut|rate.*cut|dovish|recession/i.test(allText);
  signals.push({
    asset: 'DXY (USD)', price: 103.42, action: fedHawk ? 'buy' : fedDove ? 'sell' : 'hold',
    score: fedHawk ? 72 : fedDove ? 28 : 50, confidence: fedHawk || fedDove ? 70 : 35, timeframe: 'MACRO',
    factors: [{ name: 'Fed', val: fedHawk ? 'Hawkish' : fedDove ? 'Dovish' : 'Neutral', impact: fedHawk ? '+' : fedDove ? '-' : '~' }],
    drivers: ['Fed hike = DXY ↑ = BTC ↓', 'Fed cut = DXY ↓ = BTC ↑']
  });

  return signals;
}

// ── Liquidity Index Calculator ──
function computeLiquidityIndex(data) {
  // Global Liquidity Score 0-100
  let score = 50;
  const { m2Yoy, fedBalance, stablecoinSupply, realYields, dxy } = data;
  if (m2Yoy) score += Math.min(15, m2Yoy * 3);        // M2 expansion = bullish
  if (stablecoinSupply > 170) score += 8;                // High stablecoin = dry powder
  if (realYields && realYields < 1) score += 5;          // Low real yields = bullish
  if (dxy && dxy < 103) score += 5;                      // Weak dollar = bullish
  if (dxy && dxy > 106) score -= 8;                      // Strong dollar = bearish
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Market Regime Detector ──
function detectRegime(data) {
  const { vix, dxy, yields10y, spxChg, btcChg, fng } = data;
  let riskScore = 50;
  if (vix > 30) riskScore -= 20;
  else if (vix < 15) riskScore += 15;
  else if (vix > 22) riskScore -= 8;
  if (dxy > 106) riskScore -= 10;
  else if (dxy < 101) riskScore += 10;
  if (yields10y > 5) riskScore -= 10;
  if (spxChg > 0.5) riskScore += 5;
  else if (spxChg < -1) riskScore -= 10;
  if (fng > 60) riskScore += 5;
  else if (fng < 25) riskScore -= 10;

  riskScore = Math.max(0, Math.min(100, riskScore));
  if (riskScore >= 65) return { regime: 'RISK ON', score: riskScore, color: '#00E87A' };
  if (riskScore <= 35) return { regime: 'RISK OFF', score: riskScore, color: '#FF3D5A' };
  return { regime: 'TRANSITION', score: riskScore, color: '#f0b429' };
}

// ── Message Handler ──
self.onmessage = function(e) {
  const { type, payload, id } = e.data;

  switch (type) {
    case 'PARSE_RSS': {
      const items = parseRSSXML(payload.xml, payload.feedMeta);
      self.postMessage({ type: 'RSS_PARSED', payload: items, id });
      break;
    }
    case 'CLASSIFY_NEWS': {
      const classified = payload.items.map(item => ({
        ...item,
        category: classifyCategory(item.title),
        impact: classifyImpact(item.title),
        cryptoImpact: cryptoImpact(item.title)
      }));
      self.postMessage({ type: 'NEWS_CLASSIFIED', payload: classified, id });
      break;
    }
    case 'COMPUTE_SIGNALS': {
      const signals = computeSignals(payload);
      self.postMessage({ type: 'SIGNALS_COMPUTED', payload: signals, id });
      break;
    }
    case 'COMPUTE_LIQUIDITY': {
      const liq = computeLiquidityIndex(payload);
      self.postMessage({ type: 'LIQUIDITY_COMPUTED', payload: liq, id });
      break;
    }
    case 'DETECT_REGIME': {
      const regime = detectRegime(payload);
      self.postMessage({ type: 'REGIME_DETECTED', payload: regime, id });
      break;
    }
  }
};
