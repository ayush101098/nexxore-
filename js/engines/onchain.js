/* Nexxore engines — Solana Onchain Discovery Engine (long-only spot, paper).
 *
 * Answers three questions per token, in order, and keeps every answer:
 *   1. Is it receiving meaningful new demand?   (activity, buyers, flow, price)
 *   2. Can a position be entered AND exited?     (executable Jupiter quotes both ways)
 *   3. Are token, holder or pool risks too high? (explainable flags, each with source + timestamp)
 *
 * Identity is the mint address; the pool address and DEX are kept separately.
 * Symbols are display-only and never used to match.
 *
 * Data (public, no keys): DexScreener (pairs, boosts/profiles), GeckoTerminal
 * (new/trending pools, unique buyers/sellers), RugCheck (mint/freeze authority,
 * holders, risks), Jupiter lite API (executable swap quotes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.NXChain = factory(root.NXCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var MIN = 60e3, HOUR = 3600e3;
  var USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var QUOTE_MINTS = {
    So11111111111111111111111111111111111111112: 'SOL', EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT'
  };

  var PARAMS = {
    version: '1.0.0', featureSet: 'sol-fs-1.0.0',
    minAgeMin: 30, minLiqUsd: 40000, minVol1hUsd: 20000,
    probeUsd: 100, maxRoundTripPct: 4, maxPriceDivergencePct: 5, maxTop10Pct: 35, warnTop10Pct: 25,
    minTxAccel: 1.3, minBuyerAccel: 1.2, minBuyRatio: 0.55, minVolAccel: 1.2, maxPx1hPct: 120,
    stopPct: 18, trailArmPct: 25, trailPct: 12, maxHoldMs: 4 * HOUR, liqDropExitPct: 30, maxExitImpactPct: 30,
    gapBufferPct: 2, priorityFeeUsd: 0.02, landSlipPct: 0.3, scoreMin: 55, staleMs: 150e3,
    // hit-rate prior Beta(a,b), replaced by the realised record as trades close; winners are
    // trailed, so the assumed average win (targetEffPct) is above the trail-arm level
    prior: [4.5, 5.5], targetEffPct: 35, minEdgeBps: 100,
    weights: { demand: 0.30, momentum: 0.20, tradability: 0.20, flow: 0.15, breadth: 0.15 }
  };

  function n(x) { var v = typeof x === 'number' ? x : parseFloat(x); return isFinite(v) ? v : null; }
  function sc(x, k) { return 100 / (1 + Math.exp(-x / k)); }
  function cl(x) { return C.clamp(x, 0, 100); }
  function ratio(a, b) { return a != null && b != null && b > 0 ? a / b : null; }

  /* ---------------------------------------------------------- identity */

  /* Canonical pool for a mint: the deepest Solana pair in which the mint is the
     BASE token (so price is quoted per unit of that mint). */
  function resolveIdentity(mint, pairs) {
    var cands = (pairs || []).filter(function (p) { return p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint && p.pairAddress; });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0); });
    var p = cands[0];
    return { mint: mint, symbol: p.baseToken.symbol, name: p.baseToken.name, pool: p.pairAddress, dex: p.dexId,
      quoteMint: p.quoteToken && p.quoteToken.address, quoteSymbol: p.quoteToken && p.quoteToken.symbol, pair: p, poolsSeen: cands.length };
  }

  /* ---------------------------------------------------------- features */

  /* pair: DexScreener pair; gk: GeckoTerminal pool attributes (or null);
     hist: [[ts, liqUsd, priceUsd]] our own observations; now: decision time. */
  function features(pair, gk, hist, now) {
    var tx = pair.txns || {}, vol = pair.volume || {}, pc = pair.priceChange || {};
    var t5 = tx.m5 ? tx.m5.buys + tx.m5.sells : null, t1 = tx.h1 ? tx.h1.buys + tx.h1.sells : null;
    var g = gk && gk.transactions ? gk.transactions : null;
    var b5 = g && g.m5 ? g.m5.buyers : null, b1 = g && g.h1 ? g.h1.buyers : null, s1 = g && g.h1 ? g.h1.sellers : null;
    var liq = pair.liquidity ? n(pair.liquidity.usd) : null;
    var liqChg = null;
    if (hist && hist.length > 1) {
      var base = null; for (var i = 0; i < hist.length; i++) if (now - hist[i][0] <= HOUR) { base = hist[i]; break; }
      if (base && base[1] > 0 && now - base[0] >= 5 * MIN) liqChg = (liq / base[1] - 1) * 100;
    }
    return {
      ts: now, priceUsd: n(pair.priceUsd), ageMin: pair.pairCreatedAt ? (now - pair.pairCreatedAt) / MIN : null,
      liqUsd: liq, fdv: n(pair.fdv), fdvLiq: ratio(n(pair.fdv), liq),
      tx5: t5, tx1h: t1, txAccel: ratio(t5 == null ? null : t5 / 5, t1 == null ? null : t1 / 60),
      buyRatio5: t5 ? tx.m5.buys / t5 : null, buyRatio1h: t1 ? tx.h1.buys / t1 : null,
      vol5: n(vol.m5), vol1h: n(vol.h1), vol24h: n(vol.h24), volAccel: ratio(n(vol.m5) == null ? null : n(vol.m5) / 5, n(vol.h1) == null ? null : n(vol.h1) / 60),
      buyers5: b5, buyers1h: b1, sellers1h: s1, buyerAccel: ratio(b5 == null ? null : b5 / 5, b1 == null ? null : b1 / 60),
      px5: n(pc.m5), px1h: n(pc.h1), px6h: n(pc.h6), px24h: n(pc.h24), liqChgPct: liqChg,
      boosted: !!(pair.boosts && pair.boosts.active)
    };
  }

  function score(f, quote) {
    var W = PARAMS.weights, miss = [];
    var dem = [];
    if (f.txAccel != null) dem.push(sc(Math.log(Math.max(0.05, f.txAccel)), 0.35));
    if (f.buyerAccel != null) dem.push(sc(Math.log(Math.max(0.05, f.buyerAccel)), 0.35)); else miss.push('buyers');
    var D = dem.length ? C.mean(dem) : 50;
    var late = f.px1h != null && f.px1h > PARAMS.maxPx1hPct ? 30 : 0;
    var M = f.px5 == null || f.px1h == null ? 50 : cl(0.5 * sc(f.px5, 4) + 0.5 * sc(f.px1h, 15) - late);
    var liqS = f.liqUsd == null ? 0 : 100 * C.clamp((Math.log10(f.liqUsd) - 4) / 2, 0, 1); // $10k → 0, $1M → 100
    var T = quote && quote.roundTripPct != null ? 0.5 * liqS + 0.5 * 100 * C.clamp(1 - quote.roundTripPct / 8, 0, 1) : liqS;
    if (!quote) miss.push('quote');
    var F = f.buyRatio5 == null ? 50 : cl(50 + (f.buyRatio5 - 0.5) * 250);
    var B = f.buyers1h == null ? 50 : 100 * C.clamp(Math.log10(Math.max(1, f.buyers1h)) / 3, 0, 1); // 1000 unique buyers/h → 100
    var S = W.demand * D + W.momentum * M + W.tradability * T + W.flow * F + W.breadth * B;
    return { D: D, M: M, T: T, F: F, B: B, S: S, missing: miss };
  }

  /* ---------------------------------------------------------- risk flags */

  /* Explainable flags. Never a single opaque "safety score". */
  function riskFlags(report, reportTs, f) {
    var out = [], src = 'rugcheck.xyz';
    var add = function (code, sev, detail, source, ts) { out.push({ code: code, sev: sev, detail: detail, source: source || src, ts: ts || reportTs }); };
    if (!report) { add('NO_SAFETY_REPORT', 'high', 'token report unavailable — mint/freeze authority and holders unverified', src, reportTs || Date.now()); return out; }
    if (report.mintAuthority) add('MINT_AUTHORITY', 'high', 'mint authority is set — supply can be inflated');
    if (report.freezeAuthority) add('FREEZE_AUTHORITY', 'high', 'freeze authority is set — holder accounts can be frozen');
    if (report.rugged) add('RUGGED', 'high', 'reported as rugged');
    var tf = report.transferFee && n(report.transferFee.pct);
    if (tf > 0) add('TRANSFER_FEE', 'high', 'transfer fee ' + tf + '% on every transfer');
    (report.risks || []).forEach(function (r) {
      var lvl = String(r.level || '').toLowerCase();
      if (/holder|top 10|single holder/i.test(r.name || '')) return; // recomputed below from raw holders
      if (lvl === 'danger') add('RC:' + (r.name || 'risk'), 'high', r.description || r.name);
      else if (lvl === 'warn') add('RC:' + (r.name || 'risk'), 'med', r.description || r.name);
    });
    // Holder concentration excluding pool, LP and known program accounts.
    var skip = {};
    (report.markets || []).forEach(function (m) { [m.pubkey, m.liquidityA, m.liquidityB, m.liquidityAAccount, m.liquidityBAccount].forEach(function (k) { if (k) skip[k] = 1; }); });
    Object.keys(report.knownAccounts || {}).forEach(function (k) { skip[k] = 1; });
    var holders = (report.topHolders || []).filter(function (h) { return !skip[h.owner] && !skip[h.address]; });
    var top10 = holders.slice(0, 10).reduce(function (a, h) { return a + (n(h.pct) || 0); }, 0);
    var insiders = holders.filter(function (h) { return h.insider; }).length;
    if (top10 > PARAMS.maxTop10Pct) add('HOLDER_CONCENTRATION', 'high', 'top-10 non-pool holders own ' + top10.toFixed(1) + '% (max ' + PARAMS.maxTop10Pct + '%)');
    else if (top10 > PARAMS.warnTop10Pct) add('HOLDER_CONCENTRATION', 'med', 'top-10 non-pool holders own ' + top10.toFixed(1) + '%');
    if (insiders > 0 || report.graphInsidersDetected > 0) add('INSIDER_NETWORK', 'med', (report.graphInsidersDetected || insiders) + ' insider-linked wallets detected');
    if (f && f.liqChgPct != null && f.liqChgPct <= -PARAMS.liqDropExitPct) add('LIQ_DETERIORATING', 'high', 'pool liquidity ' + f.liqChgPct.toFixed(0) + '% in the last hour', 'dexscreener (observed)', f.ts);
    return out;
  }
  function holderStats(report) {
    if (!report) return null;
    var skip = {};
    (report.markets || []).forEach(function (m) { [m.pubkey, m.liquidityA, m.liquidityB].forEach(function (k) { if (k) skip[k] = 1; }); });
    Object.keys(report.knownAccounts || {}).forEach(function (k) { skip[k] = 1; });
    var hs = (report.topHolders || []).filter(function (h) { return !skip[h.owner] && !skip[h.address]; });
    return { top10Pct: hs.slice(0, 10).reduce(function (a, h) { return a + (n(h.pct) || 0); }, 0), totalHolders: report.totalHolders || null, lpProviders: report.totalLPProviders || null };
  }

  /* ---------------------------------------------------------- quotes / costs */

  /* Infer token decimals from an executable quote and the pool's USD price
     (decimals are an integer, so a few % of impact cannot change the answer). */
  function inferDecimals(outRaw, inUsd, priceUsd) {
    if (!(outRaw > 0) || !(inUsd > 0) || !(priceUsd > 0)) return null;
    var d = Math.round(Math.log10(outRaw / (inUsd / priceUsd)));
    return d >= 0 && d <= 12 ? d : null;
  }
  /* buy: Jupiter quote USDC→mint for inUsd; sell: mint→USDC for buy.outAmount. */
  function quoteStats(inUsd, buy, sell, priceUsd) {
    if (!buy || !buy.outAmount) return null;
    var outRaw = n(buy.outAmount), dec = inferDecimals(outRaw, inUsd, priceUsd);
    var r = { inUsd: inUsd, outRaw: outRaw, decimals: dec, buyImpactPct: n(buy.priceImpactPct) == null ? null : n(buy.priceImpactPct) * 100, hops: (buy.routePlan || []).length,
      route: (buy.routePlan || []).map(function (h) { return h.swapInfo && h.swapInfo.label; }).filter(Boolean).join(' → ') };
    if (dec != null) { r.qty = outRaw / Math.pow(10, dec); r.fillPx = inUsd / r.qty; r.divergencePct = (r.fillPx / priceUsd - 1) * 100; }
    if (sell && sell.outAmount) {
      r.sellUsd = n(sell.outAmount) / 1e6; r.sellImpactPct = n(sell.priceImpactPct) == null ? null : n(sell.priceImpactPct) * 100;
      r.roundTripPct = (1 - r.sellUsd / inUsd) * 100 + 2 * PARAMS.priorityFeeUsd / inUsd * 100;
    }
    return r;
  }
  /* Loss per $1 of notional if the stop is hit AND the exit happens into a pool
     with half the liquidity (constant-product impact roughly doubles), plus a
     gap buffer because a stop on a thin token is not a guaranteed price. */
  function stressLoss(q) {
    var rt = (q && q.roundTripPct != null ? q.roundTripPct : 10) / 100;
    var entry = rt / 2, stressedExit = rt;
    return { frac: PARAMS.stopPct / 100 + entry + stressedExit + PARAMS.gapBufferPct / 100,
      parts: { stop: PARAMS.stopPct, entry: entry * 100, stressedExit: stressedExit * 100, gap: PARAMS.gapBufferPct } };
  }

  /* ---------------------------------------------------------- gates + signal */

  function evaluateToken(id, f, flags, q, P) {
    P = P || PARAMS;
    var gates = [], g = function (k, ok, why) { gates.push([k, !!ok, why]); return ok; };
    g('IDENTITY', id && id.mint && id.pool && id.dex && id.pair.baseToken.address === id.mint, id ? 'mint ' + short(id.mint) + ' · pool ' + short(id.pool) + ' · ' + id.dex : 'no Solana pool with this mint as base');
    g('POOL_AGE', f.ageMin != null && f.ageMin >= P.minAgeMin, f.ageMin == null ? 'pool age unknown' : 'pool age ' + fmtAge(f.ageMin) + ' (min ' + P.minAgeMin + 'm)');
    g('LIQUIDITY', f.liqUsd >= P.minLiqUsd, 'liquidity $' + Math.round(f.liqUsd || 0).toLocaleString() + ' (min $' + P.minLiqUsd.toLocaleString() + ')');
    g('VOLUME', f.vol1h >= P.minVol1hUsd, '1h volume $' + Math.round(f.vol1h || 0).toLocaleString() + ' (min $' + P.minVol1hUsd.toLocaleString() + ')');
    var high = (flags || []).filter(function (x) { return x.sev === 'high'; });
    g('TOKEN_RISK', flags && high.length === 0, !flags ? 'safety report not yet checked' : high.length ? high.map(function (x) { return x.code; }).join(', ') : 'no unresolved high-severity flags');
    g('EXECUTABLE_EXIT', q && q.sellUsd > 0, !q ? 'no quote yet' : q.sellUsd > 0 ? 'sell route returns $' + q.sellUsd.toFixed(2) + ' for a $' + q.inUsd + ' buy' : 'no executable sell route');
    g('ROUND_TRIP', q && q.roundTripPct != null && q.roundTripPct <= P.maxRoundTripPct, q && q.roundTripPct != null ? 'round-trip cost ' + q.roundTripPct.toFixed(2) + '% at $' + q.inUsd + ' (max ' + P.maxRoundTripPct + '%)' : 'round trip not measured');
    g('DATA_CONSISTENT', q && q.divergencePct != null && Math.abs(q.divergencePct) <= P.maxPriceDivergencePct, q && q.divergencePct != null ? 'quote vs pool price ' + q.divergencePct.toFixed(2) + '% (max ±' + P.maxPriceDivergencePct + '%)' : 'cannot compare quote with pool price');
    var eligible = gates.every(function (x) { return x[1]; });

    var sig = [], s = function (k, ok, why) { sig.push([k, !!ok, why]); return ok; };
    var accelOk = f.buyerAccel != null ? f.txAccel >= P.minTxAccel && f.buyerAccel >= P.minBuyerAccel : f.txAccel >= P.minTxAccel * 1.25;
    s('DEMAND', accelOk, 'swap rate ' + fx(f.txAccel) + '× the 1h pace' + (f.buyerAccel != null ? ', unique buyers ' + fx(f.buyerAccel) + '×' : ' (unique-buyer data missing → stricter swap threshold)'));
    s('FLOW', f.buyRatio5 >= P.minBuyRatio, 'buys ' + pct(f.buyRatio5) + ' of 5m swaps (min ' + pct(P.minBuyRatio) + '; swap side as classified by the indexer)');
    s('CONFIRMATION', f.px5 > 0 && f.px1h > 0 && f.volAccel >= P.minVolAccel, 'price 5m ' + fs(f.px5) + '%, 1h ' + fs(f.px1h) + '%, volume pace ' + fx(f.volAccel) + '×');
    s('NOT_LATE', f.px1h == null || f.px1h <= P.maxPx1hPct, '1h move ' + fs(f.px1h) + '% (max ' + P.maxPx1hPct + '%)');
    var sco = score(f, q);
    s('SCORE', sco.S >= P.scoreMin, 'S = ' + sco.S.toFixed(1) + ' (min ' + P.scoreMin + ')');
    var trigger = eligible && sig.every(function (x) { return x[1]; });
    var st = stressLoss(q);
    return { eligible: eligible, trigger: trigger, gates: gates, checks: sig, score: sco, stress: st,
      failed: gates.concat(sig).filter(function (x) { return !x[1]; }).map(function (x) { return x[0]; }),
      exit: { stopPct: P.stopPct, trailArmPct: P.trailArmPct, trailPct: P.trailPct, maxHoldMs: P.maxHoldMs, liqDropExitPct: P.liqDropExitPct },
      costBps: q && q.roundTripPct != null ? q.roundTripPct * 100 : null, edge: null };
  }
  /* E[net] in bps of notional = p·win − (1−p)·loss − round-trip cost, with p from the posterior. */
  function edge(ev, post, P) {
    P = P || PARAMS;
    var p = post.p, win = P.targetEffPct * 100, loss = (P.stopPct + P.gapBufferPct) * 100, cost = ev.costBps == null ? 1000 : ev.costBps;
    ev.edge = { pWin: p, nObs: post.n, targetBps: win, stopBps: loss, costBps: cost, expBps: p * win - (1 - p) * loss - cost };
    var ok = ev.edge.expBps >= P.minEdgeBps;
    ev.checks.push(['EDGE', ok, 'E[net] ' + ev.edge.expBps.toFixed(0) + 'bp (min ' + P.minEdgeBps + ') = p ' + p.toFixed(2) + ' × ' + win + ' − ' + (1 - p).toFixed(2) + ' × ' + loss + ' − cost ' + cost.toFixed(0)]);
    if (!ok) { ev.trigger = false; ev.failed.push('EDGE'); }
    return ev;
  }

  /* Exit decision for an open token position (pure). */
  function exitDecision(pos, f, flags, now, P) {
    P = P || PARAMS;
    var px = f.priceUsd, e = pos.avgEntry;
    if (flags && flags.some(function (x) { return x.sev === 'high' && x.code !== 'NO_SAFETY_REPORT' && x.ts > pos.openedAt; })) return 'new high-severity risk flag';
    if (pos.extra.entryLiq && f.liqUsd != null && f.liqUsd <= pos.extra.entryLiq * (1 - P.liqDropExitPct / 100)) return 'liquidity deterioration (' + ((f.liqUsd / pos.extra.entryLiq - 1) * 100).toFixed(0) + '%)';
    if (px <= pos.stop) return pos.extra.trailing ? 'trailing stop' : 'stop';
    if (now - pos.openedAt >= P.maxHoldMs) return 'max hold';
    return null;
  }
  function updateTrail(pos, px, P) {
    P = P || PARAMS;
    if (px > pos.peakPx) pos.peakPx = px;
    if (pos.peakPx >= pos.avgEntry * (1 + P.trailArmPct / 100)) {
      var t = pos.peakPx * (1 - P.trailPct / 100);
      if (t > pos.stop) { pos.stop = t; pos.extra.trailing = true; }
    }
  }

  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : '—'; }
  function fmtAge(m) { return m < 60 ? Math.round(m) + 'm' : m < 2880 ? (m / 60).toFixed(1) + 'h' : Math.round(m / 1440) + 'd'; }
  function fx(x) { return x == null ? '—' : x.toFixed(2); }
  function fs(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1); }
  function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }

  /* ---------------------------------------------------------- live adapter */

  function SolLive() {
    this.health = {};
    ['dexscreener', 'geckoterminal', 'rugcheck', 'jupiter'].forEach(function (k) { this.health[k] = { ok: null, ts: 0, fails: 0, err: '' }; }, this);
    this.pairs = {}; this.gecko = {}; this.reports = {}; this.hist = {}; this.discovered = {}; this.quoteCache = {};
  }
  SolLive.prototype.get = function (src, url) {
    var h = this.health[src];
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (r.status === 429) throw new Error('rate limited (429)'); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { h.ok = true; h.ts = Date.now(); h.fails = 0; h.err = ''; return d; })
      .catch(function (e) { h.fails++; h.err = e.message; if (h.fails >= 2) h.ok = false; throw e; });
  };
  SolLive.prototype.discover = function () {
    var self = this, now = Date.now(), add = function (mint, via) {
      if (!mint || QUOTE_MINTS[mint]) return;
      var d = self.discovered[mint] = self.discovered[mint] || { mint: mint, firstSeen: now, via: [] };
      if (d.via.indexOf(via) < 0) d.via.push(via); d.lastSeen = now;
    };
    var gk = function (path, via) {
      return self.get('geckoterminal', 'https://api.geckoterminal.com/api/v2/networks/solana/' + path).then(function (d) {
        (d.data || []).forEach(function (p) {
          var base = p.relationships && p.relationships.base_token && p.relationships.base_token.data.id.replace(/^solana_/, '');
          add(base, via); if (base) self.gecko[p.attributes.address] = { a: p.attributes, ts: now };
        });
      }).catch(function () {});
    };
    var ds = function (path, via) {
      return self.get('dexscreener', 'https://api.dexscreener.com/' + path).then(function (d) {
        (Array.isArray(d) ? d : []).forEach(function (x) { if (x.chainId === 'solana') add(x.tokenAddress, via); });
      }).catch(function () {});
    };
    return Promise.all([gk('new_pools', 'new pool'), gk('trending_pools', 'trending'), ds('token-boosts/latest/v1', 'boosted'), ds('token-profiles/latest/v1', 'profile')])
      .then(function () {
        Object.keys(self.discovered).forEach(function (m) { if (now - self.discovered[m].lastSeen > 3 * HOUR) delete self.discovered[m]; });
        return self.discovered;
      });
  };
  /* Pairs for up to 30 mints per request. */
  SolLive.prototype.resolve = function (mints) {
    var self = this, chunks = [];
    for (var i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
    return chunks.reduce(function (p, ch) {
      return p.then(function () {
        return self.get('dexscreener', 'https://api.dexscreener.com/tokens/v1/solana/' + ch.join(',')).then(function (pairs) {
          var now = Date.now(), by = {};
          (pairs || []).forEach(function (pr) { var m = pr.baseToken && pr.baseToken.address; (by[m] = by[m] || []).push(pr); });
          ch.forEach(function (m) {
            var id = resolveIdentity(m, by[m]);
            self.pairs[m] = { id: id, ts: now };
            if (id) {
              var h = self.hist[m] = self.hist[m] || [];
              h.push([now, n(id.pair.liquidity && id.pair.liquidity.usd), n(id.pair.priceUsd)]);
              while (h.length && now - h[0][0] > 2 * HOUR) h.shift();
            }
          });
        }).catch(function () {});
      });
    }, Promise.resolve());
  };
  SolLive.prototype.geckoPools = function (pools) {
    var self = this;
    if (!pools.length) return Promise.resolve();
    return this.get('geckoterminal', 'https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/' + pools.slice(0, 30).join(','))
      .then(function (d) { var now = Date.now(); (d.data || []).forEach(function (p) { self.gecko[p.attributes.address] = { a: p.attributes, ts: now }; }); })
      .catch(function () {});
  };
  SolLive.prototype.report = function (mint) {
    var self = this, c = this.reports[mint];
    if (c && Date.now() - c.ts < 15 * MIN) return Promise.resolve(c);
    return this.get('rugcheck', 'https://api.rugcheck.xyz/v1/tokens/' + mint + '/report')
      .then(function (r) { self.reports[mint] = { r: r, ts: Date.now() }; return self.reports[mint]; })
      .catch(function () { self.reports[mint] = { r: null, ts: Date.now() }; return self.reports[mint]; });
  };
  SolLive.prototype.quote = function (inMint, outMint, amountRaw) {
    var url = 'https://lite-api.jup.ag/swap/v1/quote?inputMint=' + inMint + '&outputMint=' + outMint + '&amount=' + Math.floor(amountRaw) + '&slippageBps=500&restrictIntermediateTokens=true';
    return this.get('jupiter', url).then(function (q) { if (!q || !q.outAmount) throw new Error(q && q.error || 'no route'); q.fetched = Date.now(); return q; });
  };
  /* Buy-then-sell probe at inUsd. */
  SolLive.prototype.roundTrip = function (mint, inUsd, priceUsd) {
    var self = this, key = mint + ':' + inUsd, c = this.quoteCache[key];
    if (c && Date.now() - c.ts < 60e3) return Promise.resolve(c.q);
    return this.quote(USDC, mint, inUsd * 1e6).then(function (buy) {
      return self.quote(mint, USDC, buy.outAmount).then(function (sell) { return [buy, sell]; }, function () { return [buy, null]; });
    }).then(function (bs) {
      var q = quoteStats(inUsd, bs[0], bs[1], priceUsd); if (q) q.ts = Date.now();
      self.quoteCache[key] = { q: q, ts: Date.now() }; return q;
    }).catch(function () { self.quoteCache[key] = { q: null, ts: Date.now() }; return null; });
  };

  return {
    PARAMS: PARAMS, USDC: USDC, QUOTE_MINTS: QUOTE_MINTS,
    resolveIdentity: resolveIdentity, features: features, score: score, riskFlags: riskFlags, holderStats: holderStats,
    inferDecimals: inferDecimals, quoteStats: quoteStats, stressLoss: stressLoss, evaluateToken: evaluateToken, edge: edge,
    exitDecision: exitDecision, updateTrail: updateTrail, short: short, fmtAge: fmtAge, SolLive: SolLive
  };
});
