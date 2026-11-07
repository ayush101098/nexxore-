# ETHGlobal submission: paste-ready answers

Every figure below comes from the repository, the test suites or the chain. Copy one field at a time.

---

## Project name

RiskPilot

## Short description (97 characters)

Risk-aware execution engine for programmable liquidity: prices LP positions as options, you sign.

## Description

RiskPilot is an agent that decides which DeFi liquidity trades are worth their risk, then executes
only what you sign.

Every block it scans opportunities, both price gaps across Uniswap v4 pools and options-like curves
on 1inch Aqua. For each one it computes the net edge after gas, slippage, fees, hedge and a charge
for added tail risk. It stress-tests the trade against your wallet over 14 spot and volatility
scenarios, then returns APPROVE, REJECT, REQUOTE or REQUIRE_REVIEW with a one-line reason.

You choose a risk profile once (Conservative, Moderate or Aggressive) and sign it. Each block, the
agent sizes everything else from it: the stress budget, the slippage limit, the position cap and
the gas ceiling.

The workflow has four steps:

1. **Scan and assess.** Opportunities and the risk decision. For example: "Rejected: adds $629.93
   worst-case loss, limit $250."
2. **Options-like payoff on 1inch Aqua.** A one-sided swap curve behaves like a covered call or a
   cash-secured put, and RiskPilot prices it as one: equivalent strike, term and Black-Scholes
   value. The fee floor is f_min = (1 + m) · C_eq / K_eq.
3. **Volatility-aware execution on Uniswap v4.** Our hook sets the pool fee from the pool's own
   realized volatility, so the same gap nets more in a calm market.
4. **Settlement in USDC on Arc.** The stake is escrowed per decision. A worker settles it once the
   trade is verified.

"Approve and sign" is the only trade control. One click runs every transaction the decision needs,
with exact-amount approvals and a re-simulation before each one.

Ask RiskPilot, a private assistant on 0G, answers questions about your own positions, using only
the engine's numbers.

## How it's made

**Engine.** Python and FastAPI. Decisions are deterministic:

- `decision_id = hash(inputs, block, engine version)`;
- every decision replays identically from its stored inputs;
- each one is signed as EIP-712 `RiskPilotDecision{id, wallet, inputsHash, verdict, expiresAt}`.

A block watcher follows `newHeads` over WebSocket and pushes updates to the page over server-sent
events. Block to verdict on screen takes about 130 ms. The API lives under `/v1`, described by
`docs/openapi.yaml`, and `POST /v1/decisions/{id}/build` returns EIP-5792 `calls[]`. Decisions are
stored in SQLite locally and in Neon Postgres on the hosted agent.

**Contracts (Foundry):**

- `VolatilityFeeHook`: an EWMA of the pool's tick returns, updated once per block in `beforeSwap`.
  The fee is clamp(500 + 5,000 · σ, 500, 10,000) pips, returned with `OVERRIDE_FEE_FLAG`.
- 1inch Aqua: XYCConcentrate curves on AquaSwapVMRouter.
- `RiskPilotEscrow` on Arc: per-decision USDC escrow with a 24-hour refund.

**Demo chain.** A pinned Ethereum mainnet fork (block 26,354,292), with the real PoolManager,
StateView, V4Quoter and Aqua, plus our hook and its pools.

**Web.** viem, EIP-6963 wallet discovery, EIP-5792 batches where the wallet supports them, and
shadcn-style UI.

**SDK.** `@riskpilot/sdk`, plus an example agent (`sdk/examples/agent.ts`) that verifies a
decision, builds, executes and reports.

**Tests:**

- 104 engine tests;
- 19 schema tests;
- 21 end-to-end tests (Playwright, including a real engine kill and a slow-signer flow);
- 25 Foundry tests: 12 Aqua fork, 6 hook, 7 escrow.

**Honest limits:**

- The hooked and static v4 pools are seeded on the fork.
- Arc settlement uses a trusted operator key; the 24-hour refund protects the user.
- No WalletConnect.

## Partner prizes

### Uniswap v4

`riskpilot/contracts/hook/src/VolatilityFeeHook.sol` is a dynamic-fee hook with no oracle. It
reads the tick in `beforeSwap` once per block, keeps an EWMA of squared returns (β 0.94, capped at
200 ticks per block, decayed over skipped blocks), and returns the fee with `OVERRIDE_FEE_FLAG`.

The engine prices every trade at the fee it will pay. The same $10,000 gap:

| Pool | Fee | Net edge | Verdict |
|---|---|---|---|
| Hooked pool, calm market | 0.22% | $15.38 | APPROVE |
| Static 0.30% pool | 0.30% | $7.19 | APPROVE |
| Mainnet's own 0.30% pool | 0.30% | −$15.80 | REJECT |

`make hook-volatile` moves the hook fee from 2,161 to 8,976 pips. On the next block the hooked gap
flips to REJECT. Developer feedback is in `riskpilot/FEEDBACK.md`.

### Arc

`RiskPilotEscrow` is live on Arc testnet at `0x64c1Af27bdBEcdA432BB4C8cCFec83099962e51E`. Each
approved decision escrows USDC under `keccak256(decision_id)` through the 6-decimal ERC-20
interface. The arc-worker follows `Funded` events, waits for the verified trade, and settles with
the operator key; it never settles twice.

First end-to-end settlement: decision `dec_05112ccde05df4d6`, funded 5 USDC
(tx `0x11b7a770fd164ed9f8618cc57e3659a0148c29b82e44a59cabda7ae7512b756d`). It was settled 10 s
later, paying 5.007865 USDC
(tx `0x32dd5be603cc22d62985c62f36626746480de5dffabc9a109666b8a410f26db4`).

### 1inch (Aqua / SwapVM)

`riskpilot/contracts/aqua/src/AquaCurves.sol` and `AquaCollateral.sol` build one-sided curves.
They are shipped through Aqua to AquaSwapVMRouter v1.0.2 from the page with one click.

The engine prices each curve as its equivalent option (K_eq, T_eq, Black-Scholes C_eq). It enforces
a fee floor, f_min = (1 + m) · C_eq / K_eq, and the shipped curve's fee (2,013,952) equals that
floor. A cross-primitive collateral check stops a v4 sale from leaving less than live curves
promise.

There are 12 fork tests.

### 0G

Ask RiskPilot runs on 0G Private Computer, using model `0gm-1.0-35b-a3b` in private trust mode. It
offers a chat about your own positions and a daily risk brief.

Every answer shows its 0G request ID and is stored with the exact context it was given. Answers are
built only from engine data (holdings, positions, Greeks, the full stress grid, recent decisions),
and every $ figure is checked against that data before it is shown.

Without 0G, users can't ask about their positions or get the daily brief, and their position data
would go to a non-private model.

## Links

- **GitHub:** https://github.com/ayush101098/nexxore- (the project is in `riskpilot/`)
- **Live demo:** https://nexxore.xyz/riskpilot (also https://nexxore.xyz/intelligence)
- **Demo video:**

## Not claimed

The Unichain Sepolia deploy of the hook is pending, so it is not claimed as deployed.
