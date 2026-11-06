// Execution adapters for the /riskpilot page (PRD 6), over viem.
//
// Each implements the PRD 1 Adapter interface:
//   validate(decision)  throws unless the decision is a live APPROVE this adapter can execute
//   simulate(decision)  eth_call dry run of the main transaction
//   buildTx(decision)   the transactions to sign, in order ({ label, prep, request })
//   verify(txHash)      reads the receipt and events, returns the Execution (PRD 1 schema)
// The engine decides; adapters only implement. The user's wallet signs every transaction.

export class AdapterRefused extends Error {}

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// A person confirming several wallet prompts takes longer than a decision's 30 s TTL. A flow that
// started while the decision was live may finish within FLOW_GRACE_MS: every step is still
// re-validated (collateral, balances) and the trade re-simulated against its minimum output.
export const FLOW_GRACE_MS = 120_000;
function requireLiveApprove(d, { startedAt } = {}) {
  if (d.verdict !== "APPROVE") throw new AdapterRefused(`decision is ${d.verdict}, not APPROVE`);
  const expires = Date.parse(d.expires_at), now = Date.now();
  if (expires > now) return;
  if (startedAt && startedAt < expires && now - startedAt <= FLOW_GRACE_MS) return;
  throw new AdapterRefused(startedAt && startedAt < expires
    ? `the signing flow took over ${FLOW_GRACE_MS / 1000} s; press Approve and sign again for a fresh decision`
    : `decision expired at ${d.expires_at}`);
}

/**
 * One click: validate -> build -> (validate + simulate, sign, confirm) per transaction -> verify.
 * onStep({ i, n, label, phase }) drives the button ("Signing 1 of 2: approve WETH…").
 * With a wallet that supports EIP-5792 atomic batches, the transactions go as one wallet_sendCalls.
 * gas: { maxFeePerGas, maxPriorityFeePerGas } from the engine's derived ceiling, when given.
 * Returns the Execution.
 */
export async function execute(adapter, decision, signer, pub, log = () => {}, { onStep = () => {}, gas = null, offset = 0, total = null, startedAt = Date.now() } = {}) {
  const flow = { startedAt };
  await adapter.validate(decision, flow);
  const txs = await adapter.buildTx(decision);
  const n = total ?? txs.length;
  if (signer.batch && txs.length > 1) return adapter.verify(await sendBatch(adapter, decision, signer, pub, txs, log, onStep, offset, n));
  let hash;
  for (const [j, tx] of txs.entries()) {
    const i = offset + j + 1;
    // Re-check before every transaction: the decision can expire, or the chain move, between steps.
    if (j > 0) await adapter.validate(decision, flow);
    if (!tx.prep) log(`simulated: ${(await adapter.simulate(decision)).summary}`);
    onStep({ i, n, label: tx.label, phase: "sign" });
    log(`${i} of ${n}: ${tx.label} · sign`);
    hash = await signer.client.writeContract({ ...tx.request, ...(gas || {}) });
    onStep({ i, n, label: tx.label, phase: "confirm" });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${tx.label} reverted (${hash})`);
    log(`${tx.label} confirmed in block ${rc.blockNumber}`, "ok");
    if (tx.request.functionName === "approve") await checkAllowance(pub, signer.address, tx.request);
  }
  return adapter.verify(hash);
}

// A wallet lets the user edit an approval's spending cap. If the confirmed allowance is below what
// the next step needs, stop here with a plain message instead of sending a transaction that reverts.
const ERC20_READ = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];
async function checkAllowance(pub, owner, request) {
  const [spender, need] = request.args;
  const token = request.address;
  const have = await pub.readContract({ address: token, abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
  if (have >= need) return;
  const [dec, sym] = await Promise.all([
    pub.readContract({ address: token, abi: ERC20_READ, functionName: "decimals" }).catch(() => 18),
    pub.readContract({ address: token, abi: ERC20_READ, functionName: "symbol" }).catch(() => "tokens"),
  ]);
  const fmt = (v) => (Number(v) / 10 ** Number(dec)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  throw new AdapterRefused(`approved ${fmt(have)} ${sym}, but this trade needs ${fmt(need)} ${sym}. `
    + "Press Approve and sign again and leave the wallet's spending cap as proposed.");
}

/** Does this wallet offer atomic batches (EIP-5792) on chainId? */
export async function supportsBatch(provider, address, chainId) {
  try {
    const caps = await provider.request({ method: "wallet_getCapabilities", params: [address] });
    const c = caps?.["0x" + chainId.toString(16)] || caps?.[chainId];
    return Boolean(c?.atomicBatch?.supported || c?.atomic?.status === "supported" || c?.atomic?.status === "ready");
  } catch { return false; }
}

async function sendBatch(adapter, decision, signer, pub, txs, log, onStep, offset, n) {
  const { viem } = signer;
  const main = txs.find((t) => !t.prep);
  log(`simulated: ${(await adapter.simulate(decision)).summary}`);
  const calls = txs.map((t) => ({ to: t.request.address, data: viem.encodeFunctionData(t.request), value: "0x0" }));
  onStep({ i: offset + 1, n, label: `${txs.length} calls in one batch`, phase: "sign" });
  log(`wallet_sendCalls · ${txs.map((t) => t.label).join(", ")}`);
  const res = await signer.provider.request({ method: "wallet_sendCalls", params: [{
    version: "1.0", chainId: "0x" + signer.chainId.toString(16), from: signer.address, atomicRequired: true, calls }] });
  const id = typeof res === "string" ? res : res.id;
  onStep({ i: offset + txs.length, n, label: main.label, phase: "confirm" });
  for (;;) {
    const st = await signer.provider.request({ method: "wallet_getCallsStatus", params: [id] });
    const done = st.status === "CONFIRMED" || st.status === 200;
    if (done) {
      const receipts = st.receipts || [];
      if (receipts.some((r) => r.status !== "0x1" && r.status !== "success")) throw new Error("batch reverted");
      const last = receipts[receipts.length - 1];
      log(`batch confirmed in block ${Number(last.blockNumber)}`, "ok");
      await pub.waitForTransactionReceipt({ hash: last.transactionHash });
      return last.transactionHash;
    }
    if (st.status >= 400) throw new Error(`batch failed (${st.status})`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── Aqua (PRD 3) ──────────────────────────────────────────────────────────
export function aquaAdapter({ viem, pub, chainId, info, A, signer }) {
  const abi = viem.parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248, uint8)",
    "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
    // quote() is non-view on-chain (it runs the program); called with eth_call only.
    "function quote((address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
    "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  ]);
  const curves = [info.upside, info.downside];
  const curveFor = (d) => (d.inputs.aqua?.side === "call_like" ? info.upside : d.inputs.aqua?.side === "put_like" ? info.downside : null);
  const need = (c) => ({ [A.WETH]: BigInt(c.weth_amount), [A.USDC]: BigInt(c.usdc_amount) });
  const raw = (c, token) => pub.readContract({ address: A.AQUA, abi, functionName: "rawBalances", args: [info.maker, A.ROUTER, c.strategy_hash, token] });
  let current = null;

  const adapter = {
    name: "aqua",

    async validate(d, flow = {}) {
      requireLiveApprove(d, flow);
      const c = curveFor(d);
      if (!c) throw new AdapterRefused("not an Aqua decision");
      if (signer.address.toLowerCase() !== info.maker.toLowerCase()) throw new AdapterRefused(`signer is not the curve's maker ${info.maker}`);
      const [, n] = await raw(c, A.WETH);
      if (n > 0) throw new AdapterRefused("this curve is already shipped");
      // Collateral check: Aqua pulls from the wallet on fill, so the wallet must cover this curve
      // plus everything live curves already promise.
      for (const [token, amt] of Object.entries(need(c))) {
        if (amt === 0n) continue;
        let committed = 0n;
        for (const other of curves) {
          const [bal, count] = await raw(other, token);
          if (count > 0) committed += bal;
        }
        const held = await pub.readContract({ address: token, abi, functionName: "balanceOf", args: [info.maker] });
        if (held < amt + committed) {
          throw new AdapterRefused(`collateral check refused: need ${amt} + ${committed} in live curves, wallet holds ${held}`);
        }
      }
      current = d;
    },

    async simulate(d) {
      const c = curveFor(d);
      const n = need(c);
      await pub.simulateContract({ account: signer.address, address: A.AQUA, abi, functionName: "ship",
        args: [A.ROUTER, c.order, [A.WETH, A.USDC], [n[A.WETH], n[A.USDC]]] });
      return { summary: `ship ${c.strategy_hash.slice(0, 10)}… succeeds` };
    },

    async buildTx(d) {
      const c = curveFor(d);
      const n = need(c);
      const txs = [];
      for (const [token, amt] of Object.entries(n)) {
        if (amt === 0n) continue;
        const allowance = await pub.readContract({ address: token, abi, functionName: "allowance", args: [info.maker, A.AQUA] });
        if (allowance < amt) {
          txs.push({ label: `approve ${token === A.WETH ? "WETH" : "USDC"} for Aqua`, prep: true,
            request: { address: token, abi, functionName: "approve", args: [A.AQUA, amt] } });
        }
      }
      txs.push({ label: "ship curve", prep: false,
        request: { address: A.AQUA, abi, functionName: "ship", args: [A.ROUTER, c.order, [A.WETH, A.USDC], [n[A.WETH], n[A.USDC]]] } });
      return txs;
    },

    async verify(hash) {
      const rc = await pub.getTransactionReceipt({ hash });
      const c = curveFor(current);
      const shipped = viem.parseEventLogs({ abi, eventName: "Shipped", logs: rc.logs })
        .some((l) => l.args.strategyHash === c.strategy_hash);
      if (rc.status !== "success" || !shipped) throw new Error("ship receipt did not verify");
      return { decision_id: current.decision_id, chain_id: chainId, tx_hash: hash, status: "confirmed", verified_at: nowIso(), settlement_tx: null };
    },

    /** router.quote() for a curve, capped at the curve's real Aqua balance of tokenOut (quote() ignores it). */
    async cappedQuote(c, tokenIn, tokenOut, amountIn) {
      const [order] = viem.decodeAbiParameters([{ type: "tuple", components: [
        { name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" }] }], c.order);
      const [, quoted] = await pub.readContract({ address: A.ROUTER, abi, functionName: "quote",
        args: [order, tokenIn, tokenOut, amountIn, info.taker_data_exact_in] });
      const [real] = await raw(c, tokenOut);
      return { quoted, fillable: quoted < real ? quoted : real, capped: quoted > real };
    },
  };
  return adapter;
}

// ── Uniswap v4 (PRD 4): the hooked pool, and the static 0.30% pool for comparison ─────────
export function v4Adapter({ viem, pub, chainId, hook, A, signer, aquaCommitted = async () => 0n }) {
  const abi = viem.parseAbi([
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, (bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) payable returns (int256 delta)",
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  ]);
  const MIN_SQRT = 4295128739n + 1n, MAX_SQRT = 1461446703485210103287273052203988822378723970342n - 1n;
  // USDC/WETH pools the demo's PoolSwapTest router can trade (currency0 = USDC, currency1 = WETH).
  const KEYS = hook ? {
    uniswap_v4_hooked: { key: { currency0: A.USDC, currency1: A.WETH, fee: 0x800000, tickSpacing: 60, hooks: hook.hook }, id: hook.hooked_pool_id },
    uniswap_v4_static: { key: { currency0: A.USDC, currency1: A.WETH, fee: 3000, tickSpacing: 20, hooks: "0x0000000000000000000000000000000000000000" }, id: hook.flat_pool_id },
  } : {};
  let current = null;
  const pool = (d) => KEYS[d.inputs.request.opportunity.source_venue];

  // The decision's trade: sell (or buy) q ETH through the pool; min-out from its quote, fee and tolerance.
  function trade(d) {
    // Slippage limit: the profile's derived tolerance (min(profile max, simulated impact + 5 bp)).
    const m = d.inputs.request.market, fee = Number(m.fee_rate);
    const tol = Number(d.inputs.profile?.slippage_tolerance ?? d.inputs.request.tolerance);
    const ethDelta = Number(d.inputs.proposed_position.params.trade_eth); // + buy ETH, - sell ETH
    const sell = ethDelta < 0, price = Number(m.quote.price);
    // 6 decimals: float noise (4.485451000000000299) would show up in the wallet's spending-cap field.
    const amountIn = sell ? viem.parseUnits(Math.abs(ethDelta).toFixed(6), 18) : viem.parseUnits(Number(d.inputs.request.size).toFixed(6), 6);
    const expected = sell ? Math.abs(ethDelta) * price * (1 - fee) : Number(d.inputs.request.size) * (1 - fee) / price;
    const minOut = sell ? viem.parseUnits((expected * (1 - tol)).toFixed(6), 6) : viem.parseUnits((expected * (1 - tol)).toFixed(18), 18);
    return { sell, tokenIn: sell ? A.WETH : A.USDC, amountIn, minOut,
      params: { zeroForOne: !sell, amountSpecified: -amountIn, sqrtPriceLimitX96: sell ? MAX_SQRT : MIN_SQRT } };
  }
  const swapRequest = (d, t) => ({ address: hook.swap_router, abi, functionName: "swap",
    args: [pool(d).key, t.params, { takeClaims: false, settleUsingBurn: false }, "0x"] });

  return {
    name: "v4",
    async validate(d, flow = {}) {
      requireLiveApprove(d, flow);
      if (!hook) throw new AdapterRefused("no v4 pools deployed (make hook-pool)");
      if (!pool(d)) throw new AdapterRefused(`no adapter for ${d.inputs.request.opportunity.source_venue}`);
      const t = trade(d);
      // Cross-primitive collateral: a WETH sale must leave what live Aqua curves have promised.
      const held = await pub.readContract({ address: t.tokenIn, abi, functionName: "balanceOf", args: [signer.address] });
      const promised = await aquaCommitted(t.tokenIn);
      if (held < t.amountIn + promised) {
        throw new AdapterRefused(`collateral check refused: selling ${t.amountIn} would leave less than the ${promised} live Aqua curves hold`);
      }
      current = d;
    },
    async simulate(d) {
      const t = trade(d);
      const { result } = await pub.simulateContract({ account: signer.address, ...swapRequest(d, t) });
      const delta = BigInt.asIntN(256, result);
      const amount0 = BigInt.asIntN(128, delta >> 128n), amount1 = BigInt.asIntN(128, delta);
      const out = t.sell ? amount0 : amount1; // positive = received
      if (out < t.minOut) throw new AdapterRefused(`simulated out ${out} below min-out ${t.minOut} (tolerance)`);
      return { summary: `out ${out} ≥ min-out ${t.minOut}` };
    },
    async buildTx(d) {
      const t = trade(d), txs = [];
      const allowance = await pub.readContract({ address: t.tokenIn, abi, functionName: "allowance", args: [signer.address, hook.swap_router] });
      if (allowance < t.amountIn) txs.push({ label: "approve for the v4 router", prep: true,
        request: { address: t.tokenIn, abi, functionName: "approve", args: [hook.swap_router, t.amountIn] } });
      txs.push({ label: "swap through the v4 pool", prep: false, request: swapRequest(d, t) });
      return txs;
    },
    async verify(hash) {
      const rc = await pub.getTransactionReceipt({ hash });
      const swapped = viem.parseEventLogs({ abi, eventName: "Swap", logs: rc.logs }).some((l) => l.args.id === pool(current).id);
      if (rc.status !== "success" || !swapped) throw new Error("swap receipt did not verify");
      return { decision_id: current.decision_id, chain_id: chainId, tx_hash: hash, status: "confirmed", verified_at: nowIso(), settlement_tx: null };
    },
    /** The fee and amounts a v4 swap actually paid, from the PoolManager Swap event in its receipt. */
    async swapInfo(hash) {
      const rc = await pub.getTransactionReceipt({ hash });
      const [log] = viem.parseEventLogs({ abi, eventName: "Swap", logs: rc.logs });
      return log ? { status: rc.status, block: rc.blockNumber, fee: Number(log.args.fee), amount0: log.args.amount0, amount1: log.args.amount1, pool: log.args.id } : null;
    },
  };
}

// ── Arc escrow (PRD 5) ────────────────────────────────────────────────────
// executed: the decision's trade is already verified, so funding it after its 30 s TTL is fine.
export function arcAdapter({ viem, arcPub, dep, usdc, stakeUnits, signer, executed = false }) {
  const abi = viem.parseAbi([
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function fund(bytes32 decisionId, uint256 amount)",
    "function deposits(bytes32) view returns (address depositor, uint64 fundedAt, uint256 amount, uint8 status)",
    "event Funded(bytes32 indexed decisionId, address indexed depositor, uint256 amount)",
  ]);
  const keyOf = (d) => viem.keccak256(viem.toHex(d.decision_id));
  let current = null;
  return {
    name: "arc",
    async validate(d, flow = {}) {
      if (executed) { if (d.verdict !== "APPROVE") throw new AdapterRefused(`decision is ${d.verdict}, not APPROVE`); }
      else requireLiveApprove(d, flow);
      if (!dep) throw new AdapterRefused("escrow not deployed on Arc");
      const [, , , status] = await arcPub.readContract({ address: dep.escrow, abi, functionName: "deposits", args: [keyOf(d)] });
      if (status !== 0) throw new AdapterRefused("this decision is already funded");
      const bal = await arcPub.readContract({ address: usdc, abi, functionName: "balanceOf", args: [signer.address] });
      if (bal < stakeUnits) throw new AdapterRefused(`wallet holds ${bal} USDC units, needs ${stakeUnits}`);
      current = d;
    },
    async simulate(d) {
      return { summary: `fund ${stakeUnits} USDC units for ${d.decision_id}` };
    },
    async buildTx(d) {
      return [
        { label: "approve USDC for the escrow", prep: true, request: { address: usdc, abi, functionName: "approve", args: [dep.escrow, stakeUnits] } },
        { label: "fund escrow", prep: false, request: { address: dep.escrow, abi, functionName: "fund", args: [keyOf(d), stakeUnits] } },
      ];
    },
    async verify(hash) {
      const rc = await arcPub.getTransactionReceipt({ hash });
      const ok = viem.parseEventLogs({ abi, eventName: "Funded", logs: rc.logs }).some((l) => l.args.decisionId === keyOf(current));
      if (rc.status !== "success" || !ok) throw new Error("fund receipt did not verify");
      return { decision_id: current.decision_id, chain_id: 5042002, tx_hash: hash, status: "confirmed", verified_at: nowIso() };
    },
  };
}
