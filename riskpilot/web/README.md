# web — PRD 6: the /riskpilot page

`index.html` (the page) and `adapters.js` (viem execution adapters). Vercel serves them at
`nexxore.xyz/riskpilot`, and the engine serves them at `http://localhost:8000/riskpilot`.
`?engine=`, `?rpc=` and `?arcRpc=` override the sources.

```bash
cd contracts/aqua && export AQUA_FORK_RPC_URL=<archive RPC> && make demo-chain   # :8545
cd contracts/hook && make hook-pool
cd engine && DEMO_RPC_URL=http://127.0.0.1:8545 ../.venv/bin/uvicorn main:app  # :8000
open http://localhost:8000/riskpilot
```

**Resetting for a fresh demo.** Run `make demo-reset` in `contracts/aqua`, then `make demo-chain`
and `make hook-pool` again. A shipped curve shows "Already shipped" until you reset.

## Layout

| Area | Shows | Source |
|---|---|---|
| Status bar | Chain (Ethereum mainnet fork · block), wallet, WETH, USDC, Balanced · $250, engine version | chain RPC, engine `/health`, `/profiles` |
| Opportunities (60%) | Type · pair, venue → target, observed vs reference, size, gross, net, verdict, age (s) | `POST /demo/seed` |
| Decision (40%) | Verdict and reason, **Approve and sign** with seconds left, cost waterfall against the hurdle, stress before → after against the budget, Aqua range, K_eq, T_eq, C_eq, f_min and fee, inputs with source and time | the stored Decision |
| Aqua curves | Status, holdings, quote capped at the real balance, ship and fill transactions with **Verify** | Aqua `rawBalances`, router `quote()`, logs |
| v4 hook | Fee (pips and %), σ_ann, pool price, gap, fee per block against a static 0.30% line | hook views, StateView, `FeeUpdated` logs |
| Arc | Escrow, reserve, fund and settle transactions, **Fund** (engine-configured stake) | Arc testnet logs |
| Decision history | Time, opportunity, verdict, reason, transaction, **Replay** | `/decisions`, `/executions` |

Rules the page follows:
- **Sources:** every number has a tooltip naming its source and timestamp.
- **Units:** every number carries one ($, %, pips, WETH, USDC, days).
- **Outages:** a 5-second heartbeat checks the engine and the chain. If either is down, its panels
  show *Source unavailable: <name>* in amber and drop their numbers, and when it comes back the
  page seeds again.
- **Verdict colours:** APPROVE green, REJECT red, REQUOTE amber, REQUIRE_REVIEW grey.

## Adapters (`adapters.js`, PRD 1 interface)

Each adapter implements `validate`, `simulate`, `buildTx` and `verify`, and refuses anything that
isn't a live APPROVE.

- **`aquaAdapter`:**
  - `validate` runs the collateral check, counting every live curve, and refuses a curve that is
    already shipped.
  - `simulate` calls `ship` with `eth_call`, and `verify` checks the `Shipped` event.
  - `cappedQuote()` caps any `router.quote()` at the curve's real Aqua balance, because `quote()`
    ignores it.
- **`v4Adapter`:**
  - It swaps through the hooked pool. Before sending, `simulate` checks the swap's output against a
    min-out from the decision's quote, fee and tolerance, and refuses if it's below.
  - The test router has no min-out argument, so the check is made off-chain.
- **`arcAdapter`:** it approves and funds the escrow for the decision through the browser wallet on
  chain 5042002, then checks the `Funded` event.

`execute()` runs the full sequence: validate, preparatory transactions (approvals), simulate, the
main transaction, then verify. The page then POSTs the Execution to the engine.

**Signing.** Signing happens in the browser, on your click.
- **Demo chain:** a browser wallet connected to chain 31337, or else Anvil account #0 (the public
  test key).
- **Arc:** a browser wallet only.

## Acceptance (checked 6 Nov 2026)

- [x] **Fits at 1440 × 900:** the status bar, Opportunities and the Decision panel, including
  **Approve and sign**, are on screen without scrolling (headless Chrome screenshot).
- [x] **Opportunity → decision → signature → transaction → verification:** clicking **Approve and
  sign** on the call-like APPROVE ran the collateral check, approved WETH, simulated the ship,
  shipped the curve and verified the `Shipped` event. The engine then opened the position.
- [x] **Every number traces to its source.** Five spot checks:
  - gross edge $48.09 comes from `/demo/seed`;
  - hook fee 10,000 pips comes from `hook.getFee`;
  - WETH 8.0000 comes from `balanceOf`;
  - K_eq $2,505.10 comes from `decision.inputs.aqua`;
  - the fill price comes from the `Swapped` log.
- [x] **Stopping the engine** blanks the engine panels to *Source unavailable*, with no old reason
  left on screen. This was tested by failing every request to the engine after load.
- [x] **Approve and sign** is disabled on both REJECTs and on a shipped or expired APPROVE.
- [x] **None of the removed items appear:** no Escalation Index, Regime, Kelly sizing, the
  Polymarket, Binance or whale feeds, BTC, Autopilot, the loop timer, paper P&L, or hero copy.
