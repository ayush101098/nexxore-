/* Nexxore execution — user-signed, non-custodial.
 *
 * Hyperliquid (DEX perps): the user's wallet approves a local agent key once
 * (agents can trade but cannot withdraw) and, if a builder is configured, a
 * maximum builder fee. Orders are then signed in the browser by the agent and
 * carry the Nexxore builder code, so the venue pays the commission to the vault.
 * Jupiter Ultra (DEX Solana): the swap carries the Nexxore referral account and
 * fee; the user's Solana wallet signs; Jupiter lands the transaction.
 * Centralised exchanges: an order ticket and referral link — the user places it.
 *
 * Wire formatting mirrors hyperliquid-python-sdk exactly (msgpack key order,
 * float_to_wire, price rounding); test/exec.test.js and a cross-check against
 * the SDK guard it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NXExec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HL = 'https://api.hyperliquid.xyz';
  var JUP = 'https://lite-api.jup.ag/ultra/v1';
  var ZERO = '0x0000000000000000000000000000000000000000';
  var USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  var lib = {};
  function init(l) { lib.ethers = l.ethers; lib.msgpack = l.msgpack; lib.web3 = l.web3; }

  /* ------------------------------------------------- wire formatting (pure) */

  function floatToWire(x) {
    var r = x.toFixed(8);
    if (Math.abs(parseFloat(r) - x) >= 1e-12) throw new Error('floatToWire causes rounding: ' + x);
    if (r.indexOf('.') >= 0) r = r.replace(/0+$/, '').replace(/\.$/, '');
    if (r === '-0') r = '0';
    return r;
  }
  /* Perp prices: ≤ 5 significant figures and ≤ (6 − szDecimals) decimals; integers always valid. */
  function roundPx(px, szDecimals) {
    if (px > 100000) return Math.round(px);
    var dp = Math.max(0, 6 - szDecimals);
    return +(+px.toPrecision(5)).toFixed(dp);
  }
  function roundSz(sz, szDecimals) { var f = Math.pow(10, szDecimals); return Math.floor(sz * f + 1e-9) / f; }
  function slippagePx(mid, isBuy, pct, szDecimals) { return roundPx(mid * (isBuy ? 1 + pct / 100 : 1 - pct / 100), szDecimals); }

  function limitWire(asset, isBuy, px, sz, reduceOnly, tif) {
    return { a: asset, b: isBuy, p: floatToWire(px), s: floatToWire(sz), r: reduceOnly, t: { limit: { tif: tif || 'Ioc' } } };
  }
  /* TP/SL trigger: market on trigger, limit p is the worst acceptable fill. */
  function triggerWire(asset, isBuy, triggerPx, sz, tpsl, szDecimals) {
    var worst = roundPx(triggerPx * (isBuy ? 1.1 : 0.9), szDecimals);
    return { a: asset, b: isBuy, p: floatToWire(worst), s: floatToWire(sz), r: true, t: { trigger: { isMarket: true, triggerPx: floatToWire(triggerPx), tpsl: tpsl } } };
  }
  function orderAction(wires, grouping, builder) {
    var a = { type: 'order', orders: wires, grouping: grouping || 'na' };
    if (builder && builder.b) a.builder = { b: builder.b.toLowerCase(), f: builder.f };
    return a;
  }
  function leverageAction(asset, leverage, isCross) { return { type: 'updateLeverage', asset: asset, isCross: !!isCross, leverage: leverage }; }

  /* Entry + TP + SL as one grouped action. plan: {asset, szDecimals, isBuy, mid, size, tpPx, slPx, slippagePct} */
  function bracket(plan, builder) {
    var sz = roundSz(plan.size, plan.szDecimals);
    if (!(sz > 0)) throw new Error('size rounds to zero');
    var wires = [limitWire(plan.asset, plan.isBuy, slippagePx(plan.mid, plan.isBuy, plan.slippagePct, plan.szDecimals), sz, false, 'Ioc')];
    if (plan.tpPx) wires.push(triggerWire(plan.asset, !plan.isBuy, roundPx(plan.tpPx, plan.szDecimals), sz, 'tp', plan.szDecimals));
    if (plan.slPx) wires.push(triggerWire(plan.asset, !plan.isBuy, roundPx(plan.slPx, plan.szDecimals), sz, 'sl', plan.szDecimals));
    return orderAction(wires, wires.length > 1 ? 'normalTpsl' : 'na', builder);
  }
  function closeAction(asset, szDecimals, posSzi, mid, slippagePct, builder) {
    var isBuy = posSzi < 0, sz = roundSz(Math.abs(posSzi), szDecimals);
    return orderAction([limitWire(asset, isBuy, slippagePx(mid, isBuy, slippagePct, szDecimals), sz, true, 'Ioc')], 'na', builder);
  }

  /* Commission maths. Hyperliquid builder fee f is in tenths of a basis point. */
  function builderFeeUsd(notional, tenthsBps) { return notional * tenthsBps / 1e5; }
  function feeRateString(tenthsBps) { return floatToWire(tenthsBps / 1000) + '%'; } // 50 → "0.05%"

  /* ---------------------------------------------------------- signing */

  function u64(n) { var b = new Uint8Array(8); var v = BigInt(n); for (var i = 7; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }
  function concat(parts) { var n = parts.reduce(function (a, p) { return a + p.length; }, 0), o = new Uint8Array(n), k = 0; parts.forEach(function (p) { o.set(p, k); k += p.length; }); return o; }
  function actionHash(action, vaultAddress, nonce) {
    var parts = [lib.msgpack.encode(action), u64(nonce)];
    if (!vaultAddress) parts.push(new Uint8Array([0]));
    else parts.push(new Uint8Array([1]), lib.ethers.getBytes(vaultAddress));
    return lib.ethers.keccak256(concat(parts));
  }
  function splitSig(sig) { var s = lib.ethers.Signature.from(sig); return { r: s.r, s: s.s, v: s.v }; }
  /* L1 action (orders, leverage) signed by the local agent key. */
  function signL1(agentWallet, action, nonce, isMainnet) {
    var phantom = { source: isMainnet === false ? 'b' : 'a', connectionId: actionHash(action, null, nonce) };
    return agentWallet.signTypedData(
      { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO },
      { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
      phantom).then(splitSig);
  }

  var USER_TYPES = {
    approveAgent: ['HyperliquidTransaction:ApproveAgent', [{ name: 'hyperliquidChain', type: 'string' }, { name: 'agentAddress', type: 'address' }, { name: 'agentName', type: 'string' }, { name: 'nonce', type: 'uint64' }]],
    approveBuilderFee: ['HyperliquidTransaction:ApproveBuilderFee', [{ name: 'hyperliquidChain', type: 'string' }, { name: 'maxFeeRate', type: 'string' }, { name: 'builder', type: 'address' }, { name: 'nonce', type: 'uint64' }]]
  };
  function userTypedData(action) {
    var t = USER_TYPES[action.type];
    return {
      domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: parseInt(action.signatureChainId, 16), verifyingContract: ZERO },
      types: (function () { var o = {}; o[t[0]] = t[1]; return o; })(), primaryType: t[0], message: action
    };
  }
  /* User-signed action through an EIP-1193 wallet (MetaMask, Rabby…). */
  function signUser(provider, address, action) {
    var d = userTypedData(action);
    var payload = { types: Object.assign({ EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] }, d.types),
      primaryType: d.primaryType, domain: d.domain, message: d.message };
    return provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(payload)] }).then(splitSig);
  }

  /* ----------------------------------------------------- Hyperliquid client */

  function post(path, body) {
    return fetch(HL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { status: 'err', response: 'HTTP ' + r.status }; }); });
  }
  function info(body) { return post('/info', body); }
  function exchange(action, nonce, signature) {
    return post('/exchange', { action: action, nonce: nonce, signature: signature, vaultAddress: null }).then(function (r) {
      if (!r || r.status !== 'ok') throw new Error(typeof r.response === 'string' ? r.response : JSON.stringify(r.response || r));
      return r.response;
    });
  }
  /* Per-order statuses → readable result. */
  function statuses(resp) {
    var st = (resp && resp.data && resp.data.statuses) || [];
    return st.map(function (s) {
      if (s.filled) return { ok: true, kind: 'filled', sz: +s.filled.totalSz, px: +s.filled.avgPx, oid: s.filled.oid };
      if (s.resting) return { ok: true, kind: 'resting', oid: s.resting.oid };
      if (s === 'waitingForFill' || s === 'waitingForTrigger') return { ok: true, kind: s };
      return { ok: false, kind: 'error', error: s.error || JSON.stringify(s) };
    });
  }

  function agentKey(user) { return 'nx_hl_agent_' + user.toLowerCase(); }
  function loadAgent(user) {
    try { var a = JSON.parse(localStorage.getItem(agentKey(user))); if (a && a.pk) return new lib.ethers.Wallet(a.pk); } catch (e) {}
    return null;
  }

  /* Hyperliquid session for a connected EVM wallet. */
  function HLSession(provider, user) { this.provider = provider; this.user = user; this.agent = loadAgent(user); this.lastNonce = 0; }
  HLSession.prototype.nonce = function () { var n = Date.now(); if (n <= this.lastNonce) n = this.lastNonce + 1; this.lastNonce = n; return n; };
  HLSession.prototype.chainHex = function () { return this.provider.request({ method: 'eth_chainId' }); };
  HLSession.prototype.ensureAgent = function () {
    var self = this;
    if (this.agent) return Promise.resolve(this.agent);
    var w = lib.ethers.Wallet.createRandom();
    return this.chainHex().then(function (chain) {
      var action = { type: 'approveAgent', hyperliquidChain: 'Mainnet', signatureChainId: chain, agentAddress: w.address, agentName: 'nexxore', nonce: self.nonce() };
      return signUser(self.provider, self.user, action).then(function (sig) { return exchange(action, action.nonce, sig); });
    }).then(function () {
      localStorage.setItem(agentKey(self.user), JSON.stringify({ pk: w.privateKey, address: w.address, ts: Date.now() }));
      self.agent = new lib.ethers.Wallet(w.privateKey);
      return self.agent;
    });
  };
  HLSession.prototype.ensureBuilder = function (builder, tenthsBps) {
    var self = this;
    if (!builder) return Promise.resolve(false);
    return info({ type: 'maxBuilderFee', user: this.user, builder: builder }).then(function (max) {
      if (+max >= tenthsBps) return true;
      return self.chainHex().then(function (chain) {
        var action = { type: 'approveBuilderFee', hyperliquidChain: 'Mainnet', signatureChainId: chain, maxFeeRate: feeRateString(tenthsBps), builder: builder, nonce: self.nonce() };
        return signUser(self.provider, self.user, action).then(function (sig) { return exchange(action, action.nonce, sig); }).then(function () { return true; });
      });
    });
  };
  HLSession.prototype.l1 = function (action) {
    var self = this, n = this.nonce();
    return signL1(this.agent, action, n, true).then(function (sig) { return exchange(action, n, sig); });
  };
  HLSession.prototype.state = function () { return info({ type: 'clearinghouseState', user: this.user }); };
  HLSession.prototype.fills = function () { return info({ type: 'userFills', user: this.user }); };
  HLSession.prototype.forget = function () { localStorage.removeItem(agentKey(this.user)); this.agent = null; };

  /* --------------------------------------------------------- Jupiter Ultra */

  function b64ToBytes(b) { var s = atob(b), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  function bytesToB64(u) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function jupOrder(inMint, outMint, amountRaw, taker, cfg) {
    var q = 'inputMint=' + inMint + '&outputMint=' + outMint + '&amount=' + Math.floor(amountRaw) + (taker ? '&taker=' + taker : '');
    if (cfg && cfg.referralAccount) q += '&referralAccount=' + cfg.referralAccount + '&referralFee=' + cfg.feeBps;
    return fetch(JUP + '/order?' + q).then(function (r) { return r.json(); }).then(function (o) { if (o.error || o.errorMessage) throw new Error(o.error || o.errorMessage); return o; });
  }
  /* Sign with the user's Solana wallet (Phantom/Solflare/Backpack) and let Jupiter land it. */
  function jupSwap(wallet, order) {
    if (!order.transaction) throw new Error(order.errorMessage || 'no transaction returned (check wallet balance)');
    var tx = lib.web3.VersionedTransaction.deserialize(b64ToBytes(order.transaction));
    return wallet.signTransaction(tx).then(function (signed) {
      return fetch(JUP + '/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedTransaction: bytesToB64(signed.serialize()), requestId: order.requestId }) });
    }).then(function (r) { return r.json(); }).then(function (x) { if (x.status !== 'Success') throw new Error(x.error || 'swap failed'); return x; });
  }
  function jupBalances(pubkey) { return fetch(JUP + '/balances/' + pubkey).then(function (r) { return r.json(); }); }

  /* ------------------------------------------------------ centralised tickets */

  function cexTicket(ex, cfg, t) {
    var c = cfg.cex[ex];
    var url = c.url.replace('{SYMBOL}', t.coin.toUpperCase()).replace('{symbol}', t.coin.toLowerCase());
    return { venue: c.name, url: url, rows: [
      ['Market', t.coin.toUpperCase() + 'USDT perpetual'], ['Side', t.isBuy ? 'Buy / Long' : 'Sell / Short'], ['Margin mode', 'Isolated'],
      ['Leverage', t.leverage + '×'], ['Size', floatToWire(+t.size.toPrecision(6)) + ' ' + t.coin], ['Order', 'Market'],
      ['Take profit', t.tpPx ? String(t.tpPx) : '—'], ['Stop loss', t.slPx ? String(t.slPx) : '— (hedge mode)']
    ] };
  }

  return {
    init: init, ZERO: ZERO, USDC_SOL: USDC_SOL,
    floatToWire: floatToWire, roundPx: roundPx, roundSz: roundSz, slippagePx: slippagePx, limitWire: limitWire, triggerWire: triggerWire,
    orderAction: orderAction, leverageAction: leverageAction, bracket: bracket, closeAction: closeAction,
    builderFeeUsd: builderFeeUsd, feeRateString: feeRateString, actionHash: actionHash, signL1: signL1, userTypedData: userTypedData,
    info: info, exchange: exchange, statuses: statuses, HLSession: HLSession,
    jupOrder: jupOrder, jupSwap: jupSwap, jupBalances: jupBalances, cexTicket: cexTicket
  };
});
