/* Nexxore shared edge maths — the single source for every number the
 * ledger, the edge feed and the track record show. Works in Node
 * (require('../js/edge.js')) and the browser (window.NXEdge).
 *
 * Inputs (see the v1 spec, Formulas):
 *   p    model probability of YES (0–1)
 *   m    market midpoint for YES at forecast time (0–1)
 *   q    model probability of our side: p for YES, 1 − p for NO
 *   a    best ask for our side (0–1)
 *   f    fee as a fraction (fee_bps / 10,000)
 *   c    effective cost per $1 share: a · (1 + f)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NXEdge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function feeFrac(feeBps) { return (Number(feeBps) || 0) / 10000; }

  /** Side we take: YES when the model is above the market midpoint, else NO. */
  function chooseSide(p, m) { return p > m ? 'YES' : 'NO'; }

  /** Model probability of the chosen side. */
  function sideProb(p, side) { return side === 'YES' ? p : 1 - p; }

  /** Effective cost per $1 share, fees included. */
  function effectiveCost(ask, feeBps) { return ask * (1 + feeFrac(feeBps)); }

  /** Net edge in cents per share: 100 · (q − c). */
  function netEdgeCents(q, ask, feeBps) { return 100 * (q - effectiveCost(ask, feeBps)); }

  /** Brier score of one forecast against outcome y (1 = YES, 0 = NO). */
  function brier(prob, y) { return Math.pow(prob - y, 2); }

  /** Brier skill vs. the market: 1 − mean(B_model) / mean(B_market). Null when undefined. */
  function brierSkill(meanModel, meanMarket) {
    if (meanModel == null || !meanMarket) return null;
    return 1 - meanModel / meanMarket;
  }

  /** Kelly fraction for a binary contract bought at effective cost c: (q − c) / (1 − c). */
  function kelly(q, ask, feeBps) {
    var c = effectiveCost(ask, feeBps);
    if (c >= 1) return -Infinity;
    return (q - c) / (1 - c);
  }

  /** Depth limit D: walk the asks (cheapest first), adding price × size while
   *  q − price · (1 + f) stays above zero. Levels are {price, size} in 0–1 / shares. */
  function depthLimit(q, asks, feeBps) {
    var f = feeFrac(feeBps);
    var levels = (asks || [])
      .map(function (l) { return { price: Number(l.price), size: Number(l.size) }; })
      .filter(function (l) { return l.price > 0 && l.price < 1 && l.size > 0; })
      .sort(function (x, y) { return x.price - y.price; });
    var usd = 0, shares = 0;
    for (var i = 0; i < levels.length; i++) {
      if (q - levels[i].price * (1 + f) <= 0) break;
      usd += levels[i].price * levels[i].size;
      shares += levels[i].size;
    }
    return { usd: usd, shares: shares };
  }

  /** Suggested stake: min(k/4 · B, 5% · B, D). Zero ("No bet") when k ≤ 0.
   *  depthUsd is optional; omit it to size without a book. */
  function stake(q, ask, feeBps, bankroll, depthUsd) {
    var k = kelly(q, ask, feeBps);
    if (!(k > 0)) return { kelly: k, stake: 0, noBet: true, limitedBy: null };
    var quarter = (k / 4) * bankroll, cap = 0.05 * bankroll;
    var s = Math.min(quarter, cap), by = quarter <= cap ? 'kelly' : 'cap';
    if (depthUsd != null && depthUsd < s) { s = depthUsd; by = 'depth'; }
    return { kelly: k, stake: s, noBet: false, limitedBy: by };
  }

  /** Realized return on stake in basis points, after the spread (ask) and fees.
   *  won: whether our side resolved true. */
  function netPnlBps(won, ask, feeBps) {
    var c = effectiveCost(ask, feeBps);
    if (!c) return null;
    return ((won ? 1 : 0) - c) / c * 10000;
  }

  /** Everything the ledger stores or derives for one forecast. */
  function evaluate(o) {
    var side = o.side || chooseSide(o.p, o.m);
    var q = sideProb(o.p, side);
    var out = {
      side: side,
      q: q,
      cost: effectiveCost(o.ask, o.feeBps),
      netEdgeC: netEdgeCents(q, o.ask, o.feeBps)
    };
    if (o.y === 0 || o.y === 1) {
      var won = (side === 'YES' ? o.y : 1 - o.y) === 1;
      out.won = won;
      out.brierModel = brier(o.p, o.y);
      out.brierMarket = o.m == null ? null : brier(o.m, o.y);
      out.netPnlBps = netPnlBps(won, o.ask, o.feeBps);
    }
    return out;
  }

  return {
    chooseSide: chooseSide, sideProb: sideProb, effectiveCost: effectiveCost,
    netEdgeCents: netEdgeCents, brier: brier, brierSkill: brierSkill,
    kelly: kelly, depthLimit: depthLimit, stake: stake, netPnlBps: netPnlBps,
    evaluate: evaluate
  };
});
