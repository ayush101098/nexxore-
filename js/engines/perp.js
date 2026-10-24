/* Nexxore engines — Perp Momentum Engine (Hyperliquid).
 *
 * Two independent models over the same market data:
 *   Model A  perp.scalp     seconds → 15 min   1m bars + live book + taker-flow
 *   Model B  perp.intraday  5 min → hours      5m bars (15m / 1h derived) + funding + OI
 * Separate parameters, separate posteriors, separate trade logs.
 *
 * Feature, score and signal functions are pure: given the same closed bars and
 * context they return the same decision (that is what the replay check and the
 * tests rely on). Live data enters only through PerpLive at the bottom.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.NXPerp = factory(root.NXCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var MIN = 60e3, HOUR = 3600e3;
  var FEATURE_SET = 'perp-fs-1.0.0';

  /* Venue cost schedule used by the simulator. Hyperliquid base tier (perps):
     taker 0.045%, maker 0.015%; funding settles hourly. Verified 2026-10;
     edit here when the venue changes it. */
  var VENUE = { name: 'hyperliquid', takerBps: 4.5, makerBps: 1.5, fundingIntervalMs: HOUR, minNotional: 10, scheduleAsOf: '2026-10' };

  var PARAMS = {
    'perp.scalp': {
      version: '1.0.0', interval: '1m',
      maxSpreadBps: 4, minDayVolume: 20e6, rvMinBps: 2, rvMaxBps: 60,
      breakoutLookback: 15, minRelVol: 1.8, minFlow: 0.15, minBookImb: 0.10, maxBtcAgainstBps: 10,
      stopAtr: [1.0, 2.5], stopMinBps: 12, targetR: 2, breakevenAtR: 1, maxHoldMs: 15 * MIN,
      prior: [4.4, 5.6], targetEffR: 2, minEdgeBps: 2, scoreMin: 55
    },
    'perp.intraday': {
      version: '1.0.0', interval: '5m',
      minDayVolume: 8e6, maxSpreadBps: 8, rangeBars: 24, breakoutMinAtr: 0.25, lateAtr: 1.5, maxExtensionAtr: 2.0,
      minRelVol: 1.5, minRs: 0.004, minOiChgPct: 1, stopAtr: 1.5, stopMinBps: 35,
      partialAtR: 2, partialFrac: 0.5, trailAtr: 1.0, maxHoldMs: 6 * HOUR, sessionFlatUtcHour: 24,
      prior: [3.8, 6.2], targetEffR: 2.5, minEdgeBps: 8, scoreMin: 55
    }
  };
  var WEIGHTS = { M: 0.25, V: 0.20, L: 0.15, D: 0.15, R: 0.15, G: 0.10 };

  /* ---------------------------------------------------------------- maths */

  function num(x) { return typeof x === 'number' ? x : parseFloat(x); }
  function parseCandles(raw) {
    return (raw || []).map(function (k) { return { t: k.t, T: k.T, o: num(k.o), h: num(k.h), l: num(k.l), c: num(k.c), v: num(k.v), n: k.n || 0 }; })
      .sort(function (a, b) { return a.t - b.t; });
  }
  /* Drop the in-progress bar: decisions use closed bars only. */
  function closedBars(bars, now, intervalMs) { return bars.filter(function (b) { return b.t + intervalMs <= now; }); }
  function mergeBars(old, fresh) {
    var m = {}; (old || []).forEach(function (b) { m[b.t] = b; }); fresh.forEach(function (b) { m[b.t] = b; });
    return Object.keys(m).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return m[t]; });
  }
  function ema(vals, n) { var k = 2 / (n + 1), e = vals[0], out = []; for (var i = 0; i < vals.length; i++) { e = i ? vals[i] * k + e * (1 - k) : vals[0]; out.push(e); } return out; }
  function atr(bars, n) {
    var s = Math.max(1, bars.length - n), tr = [];
    for (var i = s; i < bars.length; i++) { var p = bars[i - 1].c, b = bars[i]; tr.push(Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p))); }
    return C.mean(tr);
  }
  function logrets(bars) { var r = []; for (var i = 1; i < bars.length; i++) r.push(Math.log(bars[i].c / bars[i - 1].c)); return r; }
  function lr(a, b) { return a > 0 && b > 0 ? Math.log(a / b) : 0; }
  function sc(x, k) { return 100 / (1 + Math.exp(-x / k)); }
  function cl(x) { return C.clamp(x, 0, 100); }
  function corr(a, b) {
    var n = Math.min(a.length, b.length); if (n < 10) return 0;
    a = a.slice(-n); b = b.slice(-n);
    var ma = C.mean(a), mb = C.mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }
  /* Hedge ratio vs BTC:
     beta = cov(asset, btc) / var(btc), so a $1 asset position is hedged by $beta of BTC. */
  function beta(a, b) {
    var n = Math.min(a.length, b.length); if (n < 10) return null;
    a = a.slice(-n); b = b.slice(-n);
    var ma = C.mean(a), mb = C.mean(b), cov = 0, vb = 0;
    for (var i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); vb += (b[i] - mb) * (b[i] - mb); }
    if (!(vb > 0)) return null;
    // 5m betas are noisy: shrink toward 1 (Blume adjustment) and clamp so a hedge never dwarfs the position
    return C.clamp(0.67 * (cov / vb) + 0.33, 0.25, 2);
  }
  /* Align a benchmark series to the instrument's bar timestamps. */
  function alignedRets(bars, bench) {
    var m = {}; bench.forEach(function (b) { m[b.t] = b.c; });
    var a = [], b = [];
    for (var i = 1; i < bars.length; i++) {
      var x0 = m[bars[i - 1].t], x1 = m[bars[i].t];
      if (x0 && x1) { a.push(Math.log(bars[i].c / bars[i - 1].c)); b.push(Math.log(x1 / x0)); }
    }
    return [a, b];
  }
  function benchAt(bench, t) { // last benchmark bar at or before t
    var lo = 0, hi = bench.length - 1, r = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (bench[mid].t <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }

  /* --------------------------------------------------------- book helpers */

  function parseBook(raw) {
    if (!raw || !raw.levels) return null;
    var bids = raw.levels[0].map(function (l) { return { px: num(l.px), sz: num(l.sz) }; });
    var asks = raw.levels[1].map(function (l) { return { px: num(l.px), sz: num(l.sz) }; });
    if (!bids.length || !asks.length) return null;
    var mid = (bids[0].px + asks[0].px) / 2;
    return { time: raw.time, bids: bids, asks: asks, mid: mid, spreadBps: (asks[0].px - bids[0].px) / mid * 1e4 };
  }
  /* Depth imbalance (B − A)/(B + A) in a fixed ±bandBps window around mid, in USD. */
  function bookImbalance(book, bandBps) {
    var lo = book.mid * (1 - bandBps / 1e4), hi = book.mid * (1 + bandBps / 1e4), B = 0, A = 0;
    book.bids.forEach(function (l) { if (l.px >= lo) B += l.px * l.sz; });
    book.asks.forEach(function (l) { if (l.px <= hi) A += l.px * l.sz; });
    return { imb: B + A > 0 ? (B - A) / (B + A) : 0, bidUsd: B, askUsd: A };
  }
  /* Walk the book for a marketable order. side +1 buys asks, −1 sells bids.
     Stops at capBps from mid → the remainder is unfilled (partial fill). */
  function walkBook(book, side, qty, capBps) {
    var lv = side > 0 ? book.asks : book.bids, left = qty, cost = 0, worst = null;
    var limit = side > 0 ? book.mid * (1 + capBps / 1e4) : book.mid * (1 - capBps / 1e4);
    for (var i = 0; i < lv.length && left > 1e-12; i++) {
      if (side > 0 ? lv[i].px > limit : lv[i].px < limit) break;
      var take = Math.min(left, lv[i].sz);
      cost += take * lv[i].px; left -= take; worst = lv[i].px;
    }
    var filled = qty - left;
    return { filled: filled, avgPx: filled > 0 ? cost / filled : null, worstPx: worst, complete: left <= 1e-12,
      impactBps: filled > 0 ? ((cost / filled) - book.mid) / book.mid * 1e4 * side : null };
  }

  /* Round-trip cost estimate (bps of notional): two taker fees, the full spread
     (half on each leg), book impact both ways, and expected funding over the hold. */
  function costModel(o) {
    var impact = o.impactBps == null ? Math.max(0.5, o.spreadBps * 0.5) : Math.max(0, o.impactBps - o.spreadBps / 2);
    var fundingBps = (o.fundingHourly || 0) * 1e4 * (o.expHoldHours || 0) * o.side; // + = the position pays
    var total = 2 * VENUE.takerBps + o.spreadBps + 2 * impact + Math.max(0, fundingBps);
    return { fees: 2 * VENUE.takerBps, spread: o.spreadBps, impact: 2 * impact, funding: fundingBps, total: total };
  }

  function posterior(prior, trades) {
    var w = 0, l = 0; (trades || []).forEach(function (t) { if (t.net > 0) w++; else l++; });
    var a = prior[0] + w, b = prior[1] + l;
    return { p: a / (a + b), a: a, b: b, n: w + l };
  }
  function edgeCalc(stopBps, prm, post, cost) {
    var T = prm.targetEffR * stopBps, p = post.p;
    var gross = p * T - (1 - p) * stopBps;
    return { pWin: p, nObs: post.n, targetBps: T, stopBps: stopBps, costBps: cost.total, grossBps: gross, expBps: gross - cost.total, cost: cost };
  }

  /* -------------------------------------------------------------- features */

  /* Model B features at the last bar of `bars` (closed 5m bars, ≥ 160 needed).
     ctx: { bench (BTC 5m), eth (ETH 5m), funding (hourly rate), oiChgPct, spreadBps, dayVolume, breadth } */
  function featuresIntraday(bars, ctx) {
    var n = bars.length; if (n < 160) return null;
    var w = bars.slice(-289), last = w[w.length - 1], c = last.c;
    var closes = w.map(function (b) { return b.c; });
    var e20 = ema(closes, 20), e144 = ema(closes, 144);
    var atr5 = atr(w, 14), atr15 = atr5 * Math.sqrt(3);
    var prior = w.slice(-1 - PARAMS['perp.intraday'].rangeBars, -1);
    var hi = Math.max.apply(null, prior.map(function (b) { return b.h; })), lo = Math.min.apply(null, prior.map(function (b) { return b.l; }));
    var qv = w.map(function (b) { return b.v * b.c; });
    var relVol = C.mean(qv.slice(-3)) / Math.max(1e-9, C.mean(qv.slice(0, -3)));
    var r = logrets(w), rvRecent = C.sd(r.slice(-12)), rvBase = C.sd(r);
    var pv = 0, vv = 0; w.forEach(function (b) { var tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; });
    var vwap = vv > 0 ? pv / vv : c;
    var f = {
      t: last.t, px: c, atr15: atr15, atrFrac: atr15 / c,
      r5m: lr(c, w[w.length - 2].c), r15m: lr(c, w[w.length - 4].c), r1h: lr(c, w[w.length - 13].c), r4h: lr(c, w[Math.max(0, w.length - 49)].c),
      ema20: e20[e20.length - 1], ema144: e144[e144.length - 1], emaSlope: (e144[e144.length - 1] - e144[e144.length - 13]) / c,
      rangeHi: hi, rangeLo: lo, brkLong: (c - hi) / atr15, brkShort: (lo - c) / atr15, extension: (c - e20[e20.length - 1]) / atr15,
      relVol: relVol, volExp: rvBase > 0 ? rvRecent / rvBase : 1, vwapDev: (c - vwap) / vwap,
      pullbackLong: false, pullbackShort: false,
      funding: ctx.funding == null ? null : ctx.funding, oiChgPct: ctx.oiChgPct == null ? null : ctx.oiChgPct,
      spreadBps: ctx.spreadBps == null ? null : ctx.spreadBps, dayVolume: ctx.dayVolume == null ? null : ctx.dayVolume,
      rsBtc: null, rsEth: null, corrBtc: 0, betaBtc: null, btcR1h: null, btcR4h: null, btcTrend: 0, breadth: ctx.breadth == null ? null : ctx.breadth
    };
    // pullback-and-resume in an established trend
    var e20s = e20.slice(-7, -1), recent = w.slice(-7, -1), prev = w[w.length - 2];
    var touchedUp = recent.some(function (b, i) { return b.l <= e20s[i] + 0.15 * atr15; });
    var touchedDn = recent.some(function (b, i) { return b.h >= e20s[i] - 0.15 * atr15; });
    f.pullbackLong = c > f.ema144 && f.emaSlope > 0 && touchedUp && c > prev.h && c > f.ema20;
    f.pullbackShort = c < f.ema144 && f.emaSlope < 0 && touchedDn && c < prev.l && c < f.ema20;
    if (ctx.bench && ctx.bench.length) {
      var bi = benchAt(ctx.bench, last.t);
      if (bi >= 48) {
        var bb = ctx.bench, bc = bb[bi].c;
        f.btcR1h = lr(bc, bb[bi - 12].c); f.btcR4h = lr(bc, bb[bi - 48].c);
        var be = ema(bb.slice(Math.max(0, bi - 288), bi + 1).map(function (b) { return b.c; }), 144);
        var up = bc > be[be.length - 1] && f.btcR4h > 0, dn = bc < be[be.length - 1] && f.btcR4h < 0;
        f.btcTrend = up ? 1 : dn ? -1 : 0;
        f.rsBtc = f.r1h - f.btcR1h;
        var ar = alignedRets(w, bb.slice(Math.max(0, bi - 288), bi + 1));
        f.corrBtc = corr(ar[0], ar[1]);
        f.betaBtc = beta(ar[0], ar[1]);
      }
    }
    if (ctx.eth && ctx.eth.length) {
      var ei = benchAt(ctx.eth, last.t);
      if (ei >= 12) f.rsEth = f.r1h - lr(ctx.eth[ei].c, ctx.eth[ei - 12].c);
    }
    return f;
  }

  /* Model A features at the last closed 1m bar. live: { book, flow:{imb,n}|null, mid, dayVolume, btc1m } */
  function featuresScalp(bars, live) {
    if (bars.length < 40) return null;
    var w = bars.slice(-90), last = w[w.length - 1], c = last.c, P = PARAMS['perp.scalp'];
    var r = logrets(w);
    var prior = w.slice(-1 - P.breakoutLookback, -1);
    var hi = Math.max.apply(null, prior.map(function (b) { return b.h; })), lo = Math.min.apply(null, prior.map(function (b) { return b.l; }));
    var qv = w.map(function (b) { return b.v * b.c; });
    var pv = 0, vv = 0; w.slice(-60).forEach(function (b) { var tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; });
    var vwap = vv > 0 ? pv / vv : c;
    var a1 = atr(w, 14);
    var f = {
      t: last.t, px: c, atr1: a1, atrFrac: a1 / c,
      r1m: r[r.length - 1], r5m: lr(c, w[w.length - 6].c), accel: r[r.length - 1] - C.mean(r.slice(-6, -1)),
      rvBps: C.sd(r.slice(-30)) * 1e4, vwapDev: (c - vwap) / vwap,
      rangeHi: hi, rangeLo: lo, brkUp: c > hi, brkDn: c < lo,
      relVol: C.mean(qv.slice(-2)) / Math.max(1e-9, C.mean(qv.slice(-32, -2))),
      spreadBps: null, bookImb: null, bidUsd: null, askUsd: null, flow: null, flowN: 0,
      mid: live && live.mid ? live.mid : c, dayVolume: live ? live.dayVolume : null, btcR5m: null
    };
    if (live && live.book) { var bi = bookImbalance(live.book, 10); f.spreadBps = live.book.spreadBps; f.bookImb = bi.imb; f.bidUsd = bi.bidUsd; f.askUsd = bi.askUsd; f.mid = live.book.mid; }
    if (live && live.flow && live.flow.n >= 10) { f.flow = live.flow.imb; f.flowN = live.flow.n; }
    if (live && live.btc1m && live.btc1m.length > 6) { var b = live.btc1m; f.btcR5m = lr(b[b.length - 1].c, b[b.length - 6].c); }
    return f;
  }

  /* ------------------------------------------------------------- scoring */

  /* Components normalised 0–100, direction-aware. Missing inputs score a
     neutral 50 and are listed in `missing` so the explanation is honest. */
  function components(f, dir, kind) {
    var miss = [];
    var mom = kind === 'scalp'
      ? dir * (f.r5m / Math.max(1e-6, f.atrFrac * 2.2) + 0.5 * f.accel / Math.max(1e-6, f.atrFrac))
      : dir * (f.r1h / Math.max(1e-6, f.atrFrac * 2) + 0.5 * (f.r15m - f.r1h / 4) / Math.max(1e-6, f.atrFrac));
    var M = cl(sc(mom, 1));
    var V = cl(100 * (f.relVol - 0.5) / 2.5);
    var L;
    if (f.spreadBps == null && f.dayVolume == null) { L = 50; miss.push('L'); }
    else {
      var sp = f.spreadBps == null ? 50 : 100 * C.clamp(1 - f.spreadBps / 10, 0, 1);
      var dv = f.dayVolume == null ? 50 : 100 * C.clamp(Math.log10(Math.max(1, f.dayVolume) / 1e6) / 3, 0, 1);
      L = 0.5 * sp + 0.5 * dv;
    }
    var D = 50;
    if (kind === 'scalp') {
      if (f.flow != null) D = cl(50 + dir * f.flow * 100);
      else if (f.bookImb != null) D = cl(50 + dir * f.bookImb * 80);
      else miss.push('D');
    } else {
      if (f.funding == null && f.oiChgPct == null) miss.push('D');
      if (f.funding != null) {
        var annPct = f.funding * 24 * 365 * 100, crowd = dir * annPct; // + = trade sits with the side paying funding
        D -= C.clamp(crowd / 40, -1, 1) * 25;                          // crowding penalty / contrarian bonus
      }
      if (f.oiChgPct != null) {
        if (dir * f.r1h > 0 && f.oiChgPct > 0) D += C.clamp(f.oiChgPct / 3, 0, 1) * 25; // new positioning behind the move
        else if (f.oiChgPct < -1) D -= 10;                                               // move driven by closing
      }
      D = cl(D);
    }
    var R;
    if (kind === 'scalp') {
      if (f.btcR5m == null) { R = 50; miss.push('R'); } else R = cl(sc(dir * (f.r5m - f.btcR5m), 0.003));
    } else {
      if (f.rsBtc == null) { R = 50; miss.push('R'); }
      else R = cl(sc(dir * (f.rsEth == null ? f.rsBtc : 0.7 * f.rsBtc + 0.3 * f.rsEth), 0.01));
    }
    var G;
    if (kind === 'scalp') G = f.btcR5m == null ? 50 : cl(sc(dir * f.btcR5m, 0.002));
    else {
      if (f.btcR1h == null) { G = 50; miss.push('G'); }
      else G = cl(50 + dir * f.btcTrend * 25 + (f.breadth == null ? 0 : dir * (f.breadth - 0.5) * 50));
    }
    var S = WEIGHTS.M * M + WEIGHTS.V * V + WEIGHTS.L * L + WEIGHTS.D * D + WEIGHTS.R * R + WEIGHTS.G * G;
    return { M: M, V: V, L: L, D: D, R: R, G: G, S: S, missing: miss };
  }

  /* ---------------------------------------------------------------- models */

  /* Model B. Returns a full explanation whether or not it triggers. */
  function signalIntraday(f, prm, post) {
    var P = prm || PARAMS['perp.intraday'], out = { model: 'perp.intraday', version: P.version, featureSet: FEATURE_SET, trigger: false, checks: [], dir: 0 };
    if (!f) { out.checks.push(['DATA', false, 'not enough closed bars']); return out; }
    var dirB = f.r1h >= 0 ? 1 : -1;
    var setups = [];
    if (f.brkLong >= P.breakoutMinAtr) setups.push({ dir: 1, kind: 'breakout', dist: f.brkLong, level: f.rangeHi });
    if (f.brkShort >= P.breakoutMinAtr) setups.push({ dir: -1, kind: 'breakout', dist: f.brkShort, level: f.rangeLo });
    if (f.pullbackLong) setups.push({ dir: 1, kind: 'pullback', dist: 0, level: f.ema20 });
    if (f.pullbackShort) setups.push({ dir: -1, kind: 'pullback', dist: 0, level: f.ema20 });
    var s = setups[0];
    out.dir = s ? s.dir : dirB;
    out.comp = components(f, out.dir, 'intraday');
    out.score = out.comp.S;
    var ck = function (k, ok, why) { out.checks.push([k, !!ok, why]); return ok; };
    ck('ELIGIBLE', (f.dayVolume == null || f.dayVolume >= P.minDayVolume) && (f.spreadBps == null || f.spreadBps <= P.maxSpreadBps),
      'day volume ' + fmtUsd(f.dayVolume) + ' (min ' + fmtUsd(P.minDayVolume) + '), spread ' + fmt(f.spreadBps, 1) + 'bp (max ' + P.maxSpreadBps + ')');
    if (!ck('SETUP', s, s ? s.kind + ' ' + (s.dir > 0 ? 'long' : 'short') + (s.kind === 'breakout' ? ' ' + s.dist.toFixed(2) + '×ATR beyond the 2h range' : ' to EMA20 and resumed') : 'no breakout beyond 0.25×ATR15 or pullback-resume')) return finish(out);
    var d = s.dir;
    var regimeOk = d * Math.sign(f.px - f.ema144) > 0 || d * f.btcTrend > 0; // own trend or BTC regime agrees
    ck('REGIME', regimeOk, 'trend vs EMA144 ' + (f.px > f.ema144 ? 'up' : 'down') + ', BTC regime ' + ['down', 'flat', 'up'][f.btcTrend + 1]);
    var late = s.kind === 'breakout' ? s.dist > P.lateAtr : false;
    var ext = Math.abs(f.extension) > P.maxExtensionAtr;
    ck('NOT_LATE', !late && !ext, 'breakout distance ' + fmt(s.dist, 2) + '×ATR (max ' + P.lateAtr + '), extension from EMA20 ' + fmt(Math.abs(f.extension), 2) + '×ATR (max ' + P.maxExtensionAtr + ')');
    var conf = [];
    if (f.relVol >= P.minRelVol) conf.push('volume ' + f.relVol.toFixed(1) + '×');
    if (f.rsBtc != null && d * f.rsBtc >= P.minRs) conf.push('RS vs BTC ' + (d * f.rsBtc * 100).toFixed(2) + '%');
    if (f.oiChgPct != null && f.oiChgPct >= P.minOiChgPct && d * f.r1h > 0) conf.push('OI +' + f.oiChgPct.toFixed(1) + '%');
    ck('CONFIRMED', conf.length > 0, conf.length ? conf.join(', ') : 'no volume, relative-strength or OI confirmation');
    ck('SCORE', out.score >= P.scoreMin, 'S = ' + out.score.toFixed(1) + ' (min ' + P.scoreMin + ')');
    var stopDist = Math.max(P.stopAtr * f.atr15, f.px * P.stopMinBps / 1e4);
    out.entryPx = f.px; out.stopPx = f.px - d * stopDist; out.targetPx = f.px + d * P.partialAtR * stopDist;
    out.exit = { kind: 'staged', partialAtPx: out.targetPx, partialFrac: P.partialFrac, trailAtrUsd: P.trailAtr * f.atr15, maxHoldMs: P.maxHoldMs, flatUtc: true };
    var cost = costModel({ spreadBps: f.spreadBps == null ? 2 : f.spreadBps, impactBps: f.impactBps, fundingHourly: f.funding, expHoldHours: 3, side: d });
    out.edge = edgeCalc(stopDist / f.px * 1e4, P, post || posterior(P.prior, []), cost);
    ck('EDGE', out.edge.expBps >= P.minEdgeBps, 'E[net] ' + out.edge.expBps.toFixed(1) + 'bp (min ' + P.minEdgeBps + ') = p ' + out.edge.pWin.toFixed(2) + ' × ' + out.edge.targetBps.toFixed(0) + ' − ' + (1 - out.edge.pWin).toFixed(2) + ' × ' + out.edge.stopBps.toFixed(0) + ' − costs ' + cost.total.toFixed(1));
    out.setup = s; out.dir = d;
    out.rationale = s.kind + ' ' + (d > 0 ? 'long' : 'short') + '; ' + (conf.join(', ') || 'unconfirmed') + '; S ' + out.score.toFixed(0);
    return finish(out);
  }

  /* Model A. live features come from featuresScalp. */
  function signalScalp(f, prm, post) {
    var P = prm || PARAMS['perp.scalp'], out = { model: 'perp.scalp', version: P.version, featureSet: FEATURE_SET, trigger: false, checks: [], dir: 0 };
    if (!f) { out.checks.push(['DATA', false, 'not enough closed 1m bars']); return out; }
    var d = f.brkUp ? 1 : f.brkDn ? -1 : (f.r5m >= 0 ? 1 : -1);
    out.dir = d; out.comp = components(f, d, 'scalp'); out.score = out.comp.S;
    var ck = function (k, ok, why) { out.checks.push([k, !!ok, why]); return ok; };
    ck('ELIGIBLE', (f.dayVolume == null || f.dayVolume >= P.minDayVolume) && (f.spreadBps == null || f.spreadBps <= P.maxSpreadBps),
      'day volume ' + fmtUsd(f.dayVolume) + ' (min ' + fmtUsd(P.minDayVolume) + '), spread ' + fmt(f.spreadBps, 1) + 'bp (max ' + P.maxSpreadBps + ')');
    ck('VOL_BAND', f.rvBps >= P.rvMinBps && f.rvBps <= P.rvMaxBps, '1m realised vol ' + f.rvBps.toFixed(1) + 'bp (band ' + P.rvMinBps + '–' + P.rvMaxBps + ')');
    if (!ck('BREAKOUT', f.brkUp || f.brkDn, f.brkUp ? 'closed above ' + P.breakoutLookback + '-bar high' : f.brkDn ? 'closed below ' + P.breakoutLookback + '-bar low' : 'inside the ' + P.breakoutLookback + '-bar range')) return finish(out);
    var level = d > 0 ? f.rangeHi : f.rangeLo;
    var holds = d > 0 ? f.mid > level : f.mid < level;
    ck('CONFIRMED', f.relVol >= P.minRelVol && holds, 'volume ' + f.relVol.toFixed(1) + '× (min ' + P.minRelVol + '), live mid ' + (holds ? 'still beyond' : 'back inside') + ' the level');
    var flowOk = f.flow != null ? d * f.flow >= P.minFlow : (f.bookImb != null && d * f.bookImb >= P.minBookImb);
    ck('ORDER_FLOW', flowOk, f.flow != null ? 'taker imbalance ' + (f.flow * 100).toFixed(0) + '% over ' + f.flowN + ' trades (min ' + P.minFlow * 100 + '%)' :
      f.bookImb != null ? 'no trade tape; book imbalance ' + (f.bookImb * 100).toFixed(0) + '% (min ' + P.minBookImb * 100 + '%)' : 'no flow or book data');
    ck('BTC_ALIGN', f.btcR5m == null || d * f.btcR5m * 1e4 >= -P.maxBtcAgainstBps, f.btcR5m == null ? 'BTC unavailable' : 'BTC 5m ' + (f.btcR5m * 1e4).toFixed(1) + 'bp');
    ck('SCORE', out.score >= P.scoreMin, 'S = ' + out.score.toFixed(1) + ' (min ' + P.scoreMin + ')');
    var raw = Math.abs(f.px - (level - d * 0.3 * f.atr1));
    var stopDist = Math.max(C.clamp(raw, P.stopAtr[0] * f.atr1, P.stopAtr[1] * f.atr1), f.px * P.stopMinBps / 1e4);
    out.entryPx = f.mid; out.stopPx = f.mid - d * stopDist; out.targetPx = f.mid + d * P.targetR * stopDist;
    out.exit = { kind: 'bracket', breakevenAtPx: f.mid + d * P.breakevenAtR * stopDist, maxHoldMs: P.maxHoldMs, exitOnStaleFeed: true };
    var cost = costModel({ spreadBps: f.spreadBps == null ? 2 : f.spreadBps, impactBps: f.impactBps, fundingHourly: 0, expHoldHours: 0, side: d });
    out.edge = edgeCalc(stopDist / f.mid * 1e4, P, post || posterior(P.prior, []), cost);
    ck('EDGE', out.edge.expBps >= P.minEdgeBps, 'E[net] ' + out.edge.expBps.toFixed(1) + 'bp (min ' + P.minEdgeBps + ') = p ' + out.edge.pWin.toFixed(2) + ' × ' + out.edge.targetBps.toFixed(0) + ' − ' + (1 - out.edge.pWin).toFixed(2) + ' × ' + out.edge.stopBps.toFixed(0) + ' − costs ' + out.edge.costBps.toFixed(1));
    out.rationale = (d > 0 ? 'long' : 'short') + ' breakout of ' + P.breakoutLookback + 'm range, vol ' + f.relVol.toFixed(1) + '×, ' + (f.flow != null ? 'flow ' + (f.flow * 100).toFixed(0) + '%' : 'book ' + fmt(f.bookImb == null ? null : f.bookImb * 100, 0) + '%');
    return finish(out);
  }

  function finish(out) {
    out.trigger = out.checks.length > 0 && out.checks.every(function (c) { return c[1]; }) && !!out.edge;
    out.failed = out.checks.filter(function (c) { return !c[1]; }).map(function (c) { return c[0]; });
    return out;
  }
  function fmt(x, dp) { return x == null || !isFinite(x) ? '—' : x.toFixed(dp); }
  function fmtUsd(x) { return x == null ? '—' : x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : '$' + Math.round(x / 1e3) + 'K'; }

  /* ---------------------------------------------------------------- backtest */

  /* Bar-level replay through the SAME signal functions, risk engine, order state
     machine and ledger as paper mode.
       data: { coins: { COIN: { bars, funding:[{time,rate}], szDecimals, maxLeverage, spreadBps, dayVolume } }, bench, eth }
       opts: { model, costMult (default 1), latencyBars (default 0), startEquity, impactBps (default 1) }
     Execution assumptions (documented on the page):
       • decide at a bar's close; market entry at the NEXT bar's open (+latency bars), paying half-spread × costMult, impact and taker fee;
       • stop: if the bar opens through it, fill at the open (gap); else at the stop less half-spread; stop is checked before target in the same bar;
       • target/partial: fill at the level less half-spread (treated as a marketable take-profit, never a free limit fill);
       • funding at each hourly timestamp from the venue's history; liquidation if a bar opens through the isolated-margin liquidation price;
       • universe = instruments listed today (survivorship caveat reported with results). */
  function backtest(data, opts) {
    var model = opts.model, P = PARAMS[model], intervalMs = model === 'perp.scalp' ? MIN : 5 * MIN;
    var costMult = opts.costMult == null ? 1 : opts.costMult, lat = opts.latencyBars || 0, impact = (opts.impactBps == null ? 1 : opts.impactBps) * costMult;
    var t0 = Infinity, t1 = -Infinity;
    var coins = Object.keys(data.coins).sort();
    coins.forEach(function (k) { var b = data.coins[k].bars; if (b.length) { t0 = Math.min(t0, b[0].t); t1 = Math.max(t1, b[b.length - 1].t); } });
    var st = C.newState(t0, { startEquity: opts.startEquity || 10000 });
    Object.keys(st.strategies).forEach(function (id) { st.strategies[id].enabled = id === model; });
    var idx = {}; coins.forEach(function (k) { idx[k] = {}; data.coins[k].bars.forEach(function (b, i) { idx[k][b.t] = i; }); });
    var pending = [], closedTrades = [];
    var warm = model === 'perp.scalp' ? 40 : 160;
    var nTimes = Math.round((t1 - t0) / intervalMs);
    var lastFundHour = Math.floor(t0 / HOUR);
    var curve = [];

    for (var s = 0; s <= nTimes; s++) {
      var t = t0 + s * intervalMs, closeTs = t + intervalMs;
      var marks = {};
      coins.forEach(function (k) { var i = idx[k][t]; if (i != null) marks[k] = data.coins[k].bars[i].c; });

      // 1. pending entries fill at this bar's open
      pending = pending.filter(function (pe) {
        if (pe.fillAt > t) return true;
        var i = idx[pe.coin][t]; if (i == null) return true;
        var b = data.coins[pe.coin].bars[i], cd = data.coins[pe.coin];
        var half = (cd.spreadBps || 2) / 2 * costMult;
        var px = b.o * (1 + pe.side * (half + impact) / 1e4);
        var o = pe.order;
        // the stop is relative to the signal; if the open already gapped through it, the entry is cancelled
        if ((pe.side > 0 && b.o <= pe.stop) || (pe.side < 0 && b.o >= pe.stop)) { C.transition(o, 'accepted', t); C.transition(o, 'cancelled', t, 'opened through stop'); return false; }
        C.applyFill(st, o, { qty: o.qty, px: px, feeUsd: o.qty * px * VENUE.takerBps * costMult / 1e4, halfSpreadBps: half, ts: t },
          { stop: pe.stop, target: pe.target, maxHoldMs: P.maxHoldMs, exit: pe.exit, corrBtc: pe.corrBtc, extra: { mmFrac: 1 / (2 * (cd.maxLeverage || 20)) } });
        return false;
      });

      // 2. manage open positions against this bar
      Object.keys(st.positions).forEach(function (id) {
        var p = st.positions[id], i = idx[p.instrument][t]; if (i == null) return;
        var b = data.coins[p.instrument].bars[i], half = (data.coins[p.instrument].spreadBps || 2) / 2 * costMult;
        var exitAt = function (px, reason, frac) {
          var q = frac ? C.roundTo(p.qty * frac, data.coins[p.instrument].szDecimals) : p.qty;
          if (!(q > 0)) return;
          var o = C.createOrder(st, t, { intent: 'close', positionId: p.id, strategy: p.strategy, version: p.version, engine: 'perp', instrument: p.instrument, side: -p.side, qty: q, refPx: px, reason: reason });
          var fpx = px * (1 - p.side * half / 1e4);
          C.applyFill(st, o, { qty: q, px: fpx, feeUsd: q * fpx * VENUE.takerBps * costMult / 1e4, halfSpreadBps: half, ts: t }, { reason: reason });
        };
        if ((p.side > 0 && b.o <= p.liqPx) || (p.side < 0 && b.o >= p.liqPx)) { C.liquidate(st, p, t, b.o, VENUE.takerBps / 1e4); return; }
        var gapStop = p.side > 0 ? b.o <= p.stop : b.o >= p.stop;
        var hitStop = p.side > 0 ? b.l <= p.stop : b.h >= p.stop;
        if (gapStop) { exitAt(b.o, 'stop (gap)'); return; }
        if (hitStop) { exitAt(p.stop, 'stop'); return; }
        var ex = p.exit || {};
        if (ex.kind === 'bracket') {
          if ((p.side > 0 ? b.h >= p.target : b.l <= p.target)) { exitAt(p.target, 'target'); return; }
          if (!p.extra.be && (p.side > 0 ? b.h >= ex.breakevenAtPx : b.l <= ex.breakevenAtPx)) { p.stop = p.avgEntry; p.extra.be = true; C.refreshRisk(st, p); }
        } else if (ex.kind === 'staged') {
          if (!p.extra.partial && (p.side > 0 ? b.h >= ex.partialAtPx : b.l <= ex.partialAtPx)) {
            p.extra.partial = true; exitAt(ex.partialAtPx, 'partial target', ex.partialFrac);
            if (!st.positions[id]) return;
            p.stop = p.avgEntry; C.refreshRisk(st, p);
          }
          if (p.extra.partial) {
            var tr = p.side > 0 ? b.c - ex.trailAtrUsd : b.c + ex.trailAtrUsd;
            if (p.side > 0 ? tr > p.stop : tr < p.stop) { p.stop = tr; C.refreshRisk(st, p); }
          }
        }
        if (closeTs - p.openedAt >= p.maxHoldMs) { exitAt(b.c, 'max hold'); return; }
        if (ex.flatUtc && Math.floor(closeTs / C.DAY) !== Math.floor(p.openedAt / C.DAY)) { exitAt(b.c, 'session close (00:00 UTC)'); return; }
      });

      // 3. hourly funding at the venue's actual timestamps
      var hr = Math.floor(closeTs / HOUR);
      if (hr > lastFundHour) {
        for (var h = lastFundHour + 1; h <= hr; h++) {
          var fts = h * HOUR;
          Object.keys(st.positions).forEach(function (id) {
            var p = st.positions[id]; var fh = data.coins[p.instrument].funding || [];
            var rate = rateAt(fh, fts); if (rate == null) return;
            C.accrueFunding(st, p, fts, rate, marks[p.instrument] || p.avgEntry);
          });
        }
        lastFundHour = hr;
      }

      // 4. signals at this bar's close (only bars ≤ t are visible)
      var post = posterior(P.prior, closedTrades);
      coins.forEach(function (k) {
        var i = idx[k][t]; if (i == null || i < warm) return;
        var cd = data.coins[k], win = cd.bars.slice(Math.max(0, i - 300), i + 1);
        var bench = data.bench ? data.bench.slice(0, benchAt(data.bench, t) + 1) : null;
        var f, sig;
        if (model === 'perp.scalp') {
          f = featuresScalp(win, { book: null, flow: null, mid: win[win.length - 1].c, dayVolume: cd.dayVolume, btc1m: bench ? bench.slice(-10) : null });
          if (f) { f.spreadBps = cd.spreadBps; f.bookImb = 0; } // neutral: no historical book
          var P2 = Object.assign({}, P, { minBookImb: -1 }); // no historical book/tape: flow check disabled, labelled
          sig = signalScalp(f, P2, post);
        } else {
          f = featuresIntraday(win, { bench: bench, eth: data.eth ? data.eth.slice(0, benchAt(data.eth, t) + 1) : null, funding: rateAt(cd.funding || [], t), oiChgPct: null, spreadBps: cd.spreadBps, dayVolume: cd.dayVolume, breadth: null });
          sig = signalIntraday(f, P, post);
        }
        if (!sig.trigger) return;
        var dec = C.evaluate(st, { signalId: k + '@' + t, strategy: model, version: P.version, engine: 'perp', instrument: k, side: sig.dir,
          entryPx: sig.entryPx, stopPx: sig.stopPx, exitPolicy: sig.exit, expectedEdgeBps: sig.edge.expBps, minEdgeBps: P.minEdgeBps,
          dataAgeMs: 0, szDecimals: cd.szDecimals, corrBtc: f.corrBtc || 0 }, { now: closeTs, marks: marks });
        if (!dec.approved) return;
        var o = C.createOrder(st, closeTs, { intent: 'open', decisionId: dec.id, signalId: dec.signalId, strategy: model, version: P.version, engine: 'perp', instrument: k, side: sig.dir, qty: dec.qty, refPx: sig.entryPx, estCostBps: sig.edge.costBps });
        pending.push({ coin: k, side: sig.dir, order: o, stop: sig.stopPx, target: sig.targetPx, exit: sig.exit, corrBtc: f.corrBtc || 0, fillAt: t + intervalMs * (1 + lat) });
      });
      C.mark(st, closeTs, marks);
      closedTrades = st.closed.filter(function (x) { return x.strategy === model; });
      if (s % Math.max(1, Math.round(HOUR / intervalMs)) === 0) curve.push({ ts: closeTs, equity: C.fromMicro(C.equity(st, marks)) });
    }
    var trades = st.closed.slice();
    var split = t0 + (t1 - t0) * 0.6;
    var mk = function (tr) { return C.metrics(tr, curve, opts.startEquity || 10000, HOUR); };
    var res = {
      model: model, version: P.version, featureSet: FEATURE_SET, from: t0, to: t1, coins: coins, costMult: costMult, latencyBars: lat,
      trades: trades, curve: curve, metrics: mk(trades),
      inSample: C.metrics(trades.filter(function (x) { return x.openedAt < split; }), curve.filter(function (p) { return p.ts < split; }), opts.startEquity || 10000, HOUR),
      outOfSample: C.metrics(trades.filter(function (x) { return x.openedAt >= split; }), curve.filter(function (p) { return p.ts >= split; }), opts.startEquity || 10000, HOUR),
      split: split, decisions: st.decisions.length, rejected: st.decisions.filter(function (d) { return !d.approved; }).length,
      recon: C.reconcile(st), halts: st.audit.filter(function (a) { return a.action === 'suspend'; }).map(function (a) { return a.reason; })
    };
    res.fingerprint = C.hash({ data: datasetHash(data), model: model, params: P, costMult: costMult, lat: lat, trades: trades.map(function (x) { return [x.instrument, x.openedAt, x.closedAt, +x.net.toFixed(6)]; }) });
    return res;
  }
  function rateAt(hist, ts) { var r = null; for (var i = 0; i < hist.length; i++) { if (hist[i].time <= ts) r = num(hist[i].fundingRate != null ? hist[i].fundingRate : hist[i].rate); else break; } return r; }
  function datasetHash(data) {
    return C.hash(Object.keys(data.coins).sort().map(function (k) { var b = data.coins[k].bars; return [k, b.length, b.length ? b[0].t : 0, b.length ? b[b.length - 1].t : 0, b.reduce(function (a, x) { return a + x.c; }, 0).toFixed(6)]; }));
  }

  /* ------------------------------------------------------------ live feed */

  /* Hyperliquid public market data: REST /info + WebSocket. No keys. Keeps raw
     exchange timestamps and local receive timestamps for every update, detects
     staleness, reconnects with backoff, and backfills candles after a gap. */
  function PerpLive(opts) {
    this.url = 'https://api.hyperliquid.xyz/info';
    this.wsUrl = 'wss://api.hyperliquid.xyz/ws';
    this.universe = {}; this.mids = {}; this.books = {}; this.trades = {}; this.c5 = {}; this.c1 = {};
    this.oiHist = {}; this.health = { rest: { ok: null, ts: 0, fails: 0, err: '' }, ws: { ok: null, ts: 0, reconnects: 0, err: '' } };
    this.subs = {}; this.ws = null; this.wsBackoff = 1000; this.q = []; this.inflight = 0; this.onUpdate = opts && opts.onUpdate || function () {};
    this.lastTid = {};
  }
  PerpLive.prototype.post = function (body) {
    var self = this;
    return new Promise(function (resolve, reject) { self.q.push({ body: body, resolve: resolve, reject: reject }); self.pump(); });
  };
  PerpLive.prototype.pump = function () {
    var self = this;
    while (this.inflight < 2 && this.q.length) {
      var job = this.q.shift(); this.inflight++;
      (function (job) {
        fetch(self.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body) })
          .then(function (r) { if (r.status === 429) throw new Error('rate limited (429)'); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) { self.health.rest = { ok: true, ts: Date.now(), fails: 0, err: '' }; job.resolve(d); })
          .catch(function (e) {
            // 429: back off and retry (up to 3 times) before counting it as a feed failure
            if (/429/.test(e.message) && (job.tries = (job.tries || 0) + 1) <= 3) { setTimeout(function () { self.q.unshift(job); self.pump(); }, 1500 * job.tries); return; }
            var h = self.health.rest; h.fails++; h.err = e.message; if (h.fails >= 3) h.ok = false; job.reject(e);
          })
          .then(function () { self.inflight--; setTimeout(function () { self.pump(); }, 60); });
      })(job);
    }
  };
  PerpLive.prototype.refreshUniverse = function () {
    var self = this;
    return this.post({ type: 'metaAndAssetCtxs' }).then(function (d) {
      var now = Date.now(), meta = d[0].universe, ctxs = d[1];
      meta.forEach(function (m, i) {
        var x = ctxs[i] || {};
        var u = self.universe[m.name] = {
          coin: m.name, idx: i, szDecimals: m.szDecimals, maxLeverage: m.maxLeverage, onlyIsolated: !!m.onlyIsolated, delisted: !!m.isDelisted,
          mark: num(x.markPx), mid: x.midPx == null ? null : num(x.midPx), oracle: num(x.oraclePx), funding: num(x.funding),
          oi: num(x.openInterest), dayVolume: num(x.dayNtlVlm), prevDay: num(x.prevDayPx), impact: x.impactPxs ? x.impactPxs.map(num) : null, ts: now
        };
        var h = self.oiHist[m.name] = self.oiHist[m.name] || [];
        if (u.oi > 0) { h.push([now, u.oi * u.mark]); while (h.length && now - h[0][0] > 2 * HOUR) h.shift(); }
      });
      self.onUpdate('universe');
      return self.universe;
    });
  };
  PerpLive.prototype.eligible = function (minVol) {
    var self = this;
    return Object.keys(this.universe).map(function (k) { return self.universe[k]; })
      .filter(function (u) { return !u.delisted && u.mark > 0 && u.mid != null && u.dayVolume >= minVol && u.coin !== 'BTC' && u.coin !== 'ETH'; })
      .sort(function (a, b) { return b.dayVolume - a.dayVolume; });
  };
  /* Notional OI change over the last hour of our own observations (null until 15 min observed). */
  PerpLive.prototype.oiChange = function (coin) {
    var h = this.oiHist[coin]; if (!h || h.length < 2) return null;
    var now = h[h.length - 1], base = null;
    for (var i = 0; i < h.length; i++) if (now[0] - h[i][0] <= HOUR) { base = h[i]; break; }
    if (!base || now[0] - base[0] < 15 * MIN) return null;
    return (now[1] / base[1] - 1) * 100;
  };
  PerpLive.prototype.candles = function (coin, interval, lookbackMs) {
    var self = this, store = interval === '1m' ? this.c1 : this.c5, ivl = interval === '1m' ? MIN : 5 * MIN;
    var have = store[coin] && store[coin].bars.length ? store[coin].bars : null;
    var start = have ? have[have.length - 1].t - 2 * ivl : Date.now() - lookbackMs; // overlap → gap reconciliation
    return this.post({ type: 'candleSnapshot', req: { coin: coin, interval: interval, startTime: start } }).then(function (raw) {
      var bars = mergeBars(have, parseCandles(raw)).filter(function (b) { return b.t >= Date.now() - lookbackMs - ivl; });
      var gaps = 0; for (var i = 1; i < bars.length; i++) if (bars[i].t - bars[i - 1].t > ivl) gaps++;
      store[coin] = { bars: bars, ts: Date.now(), gaps: gaps };
      return store[coin];
    });
  };
  PerpLive.prototype.book = function (coin) {
    var self = this;
    return this.post({ type: 'l2Book', coin: coin }).then(function (raw) { var b = parseBook(raw); if (b) { b.received = Date.now(); self.books[coin] = b; } return b; });
  };
  PerpLive.prototype.fundingHistory = function (coin, startTime) { return this.post({ type: 'fundingHistory', coin: coin, startTime: startTime }); };

  PerpLive.prototype.connect = function () {
    var self = this;
    if (typeof WebSocket === 'undefined') return;
    try { this.ws = new WebSocket(this.wsUrl); } catch (e) { this.health.ws = { ok: false, ts: 0, reconnects: this.health.ws.reconnects, err: e.message }; return; }
    this.ws.onopen = function () {
      self.health.ws.ok = true; self.health.ws.err = ''; self.wsBackoff = 1000;
      self.send({ method: 'subscribe', subscription: { type: 'allMids' } });
      Object.keys(self.subs).forEach(function (k) { self.send({ method: 'subscribe', subscription: self.subs[k] }); });
    };
    this.ws.onmessage = function (ev) {
      var now = Date.now(), m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      self.health.ws.ts = now;
      if (m.channel === 'allMids') { var mids = m.data.mids; Object.keys(mids).forEach(function (k) { self.mids[k] = { px: num(mids[k]), ts: now }; }); }
      else if (m.channel === 'l2Book') { var b = parseBook(m.data); if (b) { b.received = now; self.books[m.data.coin] = b; } }
      else if (m.channel === 'trades') {
        (m.data || []).forEach(function (t) {
          var arr = self.trades[t.coin] = self.trades[t.coin] || [];
          if (self.lastTid[t.tid]) return; self.lastTid[t.tid] = 1;                       // dedupe by trade id
          arr.push({ px: num(t.px), sz: num(t.sz), side: t.side, time: t.time, recv: now });
          while (arr.length && now - arr[0].recv > 5 * MIN) arr.shift();
        });
      }
    };
    this.ws.onclose = this.ws.onerror = function () {
      if (self.ws === null) return;
      self.health.ws.ok = false; self.health.ws.err = 'disconnected'; self.health.ws.reconnects++;
      var ws = self.ws; self.ws = null; try { ws.close(); } catch (e) {}
      setTimeout(function () { self.connect(); }, self.wsBackoff);
      self.wsBackoff = Math.min(30000, self.wsBackoff * 2);
      self.onUpdate('ws-gap');                                                          // app re-snapshots books/candles
    };
  };
  PerpLive.prototype.send = function (m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); };
  /* Keep l2Book + trades subscriptions for exactly this set of coins. */
  PerpLive.prototype.watch = function (coins) {
    var self = this, want = {};
    coins.forEach(function (c) { want['l2Book:' + c] = { type: 'l2Book', coin: c }; want['trades:' + c] = { type: 'trades', coin: c }; });
    Object.keys(this.subs).forEach(function (k) { if (!want[k]) { self.send({ method: 'unsubscribe', subscription: self.subs[k] }); delete self.subs[k]; } });
    Object.keys(want).forEach(function (k) { if (!self.subs[k]) { self.subs[k] = want[k]; self.send({ method: 'subscribe', subscription: want[k] }); } });
  };
  /* Taker imbalance (buy − sell)/(total) by notional over the last windowMs. 'B' = aggressive buy as the venue reports it. */
  PerpLive.prototype.flow = function (coin, windowMs) {
    var arr = this.trades[coin]; if (!arr) return null;
    var now = Date.now(), b = 0, s = 0, n = 0;
    arr.forEach(function (t) { if (now - t.recv <= windowMs) { var x = t.px * t.sz; if (t.side === 'B') b += x; else s += x; n++; } });
    return { imb: b + s > 0 ? (b - s) / (b + s) : 0, n: n };
  };
  PerpLive.prototype.midAge = function (coin) {
    var m = this.mids[coin], b = this.books[coin], u = this.universe[coin], now = Date.now();
    return Math.min(m ? now - m.ts : Infinity, b ? now - b.received : Infinity, u ? now - u.ts : Infinity);
  };
  PerpLive.prototype.price = function (coin) {
    var m = this.mids[coin], b = this.books[coin], u = this.universe[coin];
    var cands = [m && [m.ts, m.px], b && [b.received, b.mid], u && [u.ts, u.mid || u.mark]].filter(Boolean).sort(function (a, b2) { return b2[0] - a[0]; });
    return cands.length ? cands[0][1] : null;
  };

  return {
    VENUE: VENUE, PARAMS: PARAMS, WEIGHTS: WEIGHTS, FEATURE_SET: FEATURE_SET,
    beta: beta, parseCandles: parseCandles, closedBars: closedBars, mergeBars: mergeBars, parseBook: parseBook, bookImbalance: bookImbalance, walkBook: walkBook,
    costModel: costModel, posterior: posterior, featuresIntraday: featuresIntraday, featuresScalp: featuresScalp, components: components,
    signalIntraday: signalIntraday, signalScalp: signalScalp, backtest: backtest, rateAt: rateAt, datasetHash: datasetHash, fmtUsd: fmtUsd,
    PerpLive: PerpLive
  };
});
