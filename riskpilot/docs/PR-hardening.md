# Hardening: RiskPilot as a service a wallet or agent can plug into

Branch `hardening`. The page and engine become a service: a profile chosen once, one user action,
push updates from the chain head, a versioned and signed API, and Arc settlement with no button.

**Not changed:** the engine's maths and verdict rules, and the contracts. The only contract-side
change is the escrow deploy script, as section 6 allows. Rule 4's *reason text* changed; the rule
itself did not.

**Tests:**
- Engine and schemas: 91 engine tests, plus 19 schema tests.
- e2e: 16 tests (`web/e2e/riskpilot.spec.ts`), all green, plus `arc.spec.ts`, green against the
  local Arc stand-in.
- Foundry: 12 Aqua, 6 hook and 7 escrow tests, unchanged and green.

**One branch, not one PR per section.** The sections share files (`api.py` and `index.html`), so
they landed as separate commits on `hardening`, not stacked PRs. Each section below lists its
commit and tests.

## Latency, measured before and after

Both columns come from the same bench (`BENCH=1 npx playwright test bench`) on the same frozen
demo chain. "Before" is `main` at `64dccc6`; "after" is this branch.

| Path | Target | Before | After |
|---|---|---|---|
| Page load to first full render | < 1.5 s | 291 ms | 365 ms |
| `/evaluate` p95 (200 fully resolved requests) | < 300 ms | 5.9 ms | 16.8 ms |
| Block to verdict on screen | < 1 s | never (no re-evaluation) | 265 ms |
| Click to first wallet prompt | < 500 ms | 33 ms | 57 ms |
| Engine down to "Source unavailable" | < 5 s | 2,889 ms | 19 ms |
| `make demo-reset` | < 30 s | no such command | 2–5 s (4–9 s with the Arc stand-in) |

**Notes on the numbers:**
- **/evaluate p95 rose** from 5.9 to 16.8 ms. It now signs every decision (EIP-712), writes a JSON
  log line and records metrics.
- **Page load rose** from 291 to 365 ms. It now opens the stream and reads the profile.
- **The demo seed dropped** from 344 ms to 98 ms, because the five source reads now run in
  parallel.
- **Engine down** is measured with a real `SIGKILL`. The SSE stream drops at once, where the old
  page waited for a 2 s poll to fail.

## Section 7, first batch (items 1–5, 9, 10, 13)

1. **Deterministic ids.**
   - `decision_id` = hash(inputs, block, engine version).
   - With a block, timestamps are hashed relative to `as_of`. Every rule depends only on input
     ages, so the same block read later gives the same id.
   - The scanner's `opportunity_id` no longer contains clock time.
   - `make demo-reset` restarts from `demo/frozen/` (Anvil state loaded read-only, plus a SQLite
     copy). It then checks that the five ids equal `demo/frozen/ids.txt`, and fails if they don't.
2. **`scripts/outage-test.sh`** (`make outage-test`) runs e2e test 7 headed. The test kills the
   engine with `SIGKILL`, and every panel must show "Source unavailable: engine" within 5 s. The
   page then recovers without a reload.
3. **Selection is kept by opportunity key**, across blocks, requotes and reseeds (e2e 4, 10).
4. **Put-like reason:** "Rejected: adds $629.93 worst-case loss; limit $250 (post-trade worst
   case $7,729.29 at -40% spot, +20 vol pts)".
   - The button reads "Rejected: adds $629.93 worst-case loss, limit $250".
   - The text follows rule 4: the trade adds loss, and the post-trade worst case is over the
     limit.
5. **"Demo pool · seeded on fork"** tags the hooked and static pools (e2e 12).
6. **Header copy:** "RiskPilot: pricing liquidity risk" / "Risk-aware execution engine for
   programmable liquidity".
7. **Balanced → Moderate** in the UI, the API and the docs. The engine accepts `balanced` as an
   alias.
8. **Secrets grep.** There are no API keys in tracked `riskpilot/` files. The only 64-hex values
   are the three public Anvil test keys, pool ids, an event topic and test placeholders.
   `agents/.env`, outside `riskpilot/`, is still tracked (see the end).

## Section 2: profiles chosen once

| | Conservative | Moderate | Aggressive |
|---|---|---|---|
| λ | 1.0 | 0.5 | 0.25 |
| Stress budget | 1% of wallet, cap $150 | 2.5%, cap $250 | 5%, cap $500 |
| Min net edge / k | $10 / 3 | $5 / 2 | $3 / 1.5 |
| Aqua fee margin m | 50% | 20% | 10% |
| Max slippage / position | 0.30% / 10% | 0.50% / 25% | 1.00% / 50% |

TTL 30 s, staleness 30 s and requote at 0.3% apply to every profile.

**Derived each block** (`profiles.derive`, recorded in `Decision.inputs.profile`):
- stress budget = min(share × wallet value, cap), where wallet value = (ETH + WETH) × spot + USDC;
- slippage = min(max, simulated impact + 5 bp);
- the position cap;
- gas ceiling = 2 × base fee + tip, from `eth_feeHistory`.

**Flow:**
1. On first connect the page shows three cards, none preselected.
2. Choosing one signs it (EIP-191) and sends `PUT /v1/profile`.
3. The status bar reads "Moderate · budget $250 (cap)", with the derivation in a tooltip.
4. **Change** cancels live approvals: `build` refuses decisions made under the old profile, and
   everything is re-evaluated.

**Tests:**
- Moderate stays $250 (the cap binds) and the put-like $629.93 stays a REJECT.
- Conservative is $150 (cap).
- A small wallet binds on the share.
- Slippage, gas ceiling, and an id that is the same at the same block and new at a new block.
- In e2e, Conservative also shows that its 50% Aqua margin lifts the premium floor (0.284%)
  above the curve's fee (0.227%). Rule 3b then rejects the put-like before the stress rule.

## Section 3: one user action

- **Approve and sign is the only trade control**, plus Refund after 24 h on Arc. The Re-evaluate,
  Ship, Verify and Fund buttons are gone (e2e 9 checks the DOM).
- **Receipts are verified automatically.**
- **One click runs every step** as a stepper in the button. For the call-like curve with Arc:
  Signing 1 of 4: approve WETH for Aqua… → Confirming 1 of 4… → Signing 2 of 4: ship curve… →
  Switching to Arc… → Signing 3 of 4: approve USDC for the escrow… → Signing 4 of 4: fund
  escrow… → Confirmed · view tx.
  - Approvals are for the exact amount only.
  - `validate` and `simulate` run again before every transaction.
  - A wallet that reports EIP-5792 atomic batches gets one `wallet_sendCalls` instead.
- **The engine re-evaluates on every block**, and re-issues each wallet's decisions at half their
  TTL. The countdown therefore requotes in place instead of expiring (e2e 4, 10).

## Section 6: Arc settles itself

- **`make arc-deploy SENDER=…`** deploys only. It writes `deployments/arc-testnet.json`: escrow,
  operator, USDC `0x3600…0000`, `usdc_decimals: 6`, deploy tx and block.
- **The arc-worker** (`engine/arc_worker.py`):
  - follows `Funded`;
  - waits for the decision's verified execution;
  - reads `deposits()`, and only settles a deposit whose status is Funded;
  - calls `settle(decisionId, payout)` with `ARC_OPERATOR_KEY`;
  - waits for 1 confirmation;
  - records the tx in the `settlements` table;
  - retries at 2, 8 and 30 s, then reports "Settlement failed: <reason>".
- **On the page:** Funded → Settling → Settled · view tx, and "Refund available" after 24 h.
- **Rehearsed end to end** against a local Arc stand-in (`ARC_REHEARSAL=1 make up`). `arc.spec.ts`
  goes from one click to Settled in about 3 s. It then restarts the engine and checks that exactly
  one `Settled` event exists for the decision.
- **Unit tests:** settle once, restart without a second settle, the 2/8/30 s retries then Failed,
  waiting for the execution and for the operator key, and 6-decimal payouts.

## Section 4: latency and infra

- **Block stream:** `newHeads` over WebSocket (it connects to Anvil), falling back to polling every
  2 s. The engine is the only reader of market state.
- **Push:** `GET /v1/stream` (SSE, 15 s heartbeat) replaces the page's polling.
- **Reads:** parallel, with a 1.5 s timeout each and 3-strike unavailability.
- **SQLite:** WAL mode, plus indexes on created_at, decision_id and status.
- **`/v1/health`:** dependencies, the stream mode, the engine signer, and a warning when the
  operator holds less than 1 USDC on Arc.
- **`/v1/metrics`:** p50 and p95 per route.
- **JSON logs** carry `decision_id`.
- **Debug panel:** press `d`.
- **`make up` / `make down` / `make demo-reset` / `make demo-freeze`.**
- **Read-only public page:** away from localhost, or with `?readonly=1`, the page never asks a
  wallet for anything, and Approve reads "Read-only page: run make up to sign" (e2e 13).

## Section 5: API v1 and EIP-712

- **Routes:** every route is also under `/v1`. The spec is `docs/openapi.yaml` (`make openapi`),
  served at `/v1/openapi.json`.
- **New endpoints:**
  - `PUT /v1/profile`;
  - `GET /v1/opportunities`;
  - `POST /v1/decisions/{id}/build`;
  - idempotent `POST /v1/executions`;
  - `GET /v1/positions`;
  - `GET /v1/stream`;
  - `GET /v1/settlements`.
- **`build`** returns EIP-5792 `calls[]`. It returns 409 for a REJECT, an expired decision, a bad
  signature or an old profile.
- **Signing:** decisions are signed as EIP-712 `RiskPilotDecision{id, wallet, inputsHash, verdict,
  expiresAt}` with `RISKPILOT_ENGINE_KEY`. The decision id's tooltip reads "Signed by engine 0x…".
- **Replay** compares the decision without its signature.
- **Wallets:** EIP-6963 discovery, and `wallet_switchEthereumChain` / `wallet_addEthereumChain` for
  the demo chain and Arc 5042002.

## P1, after every P0 was green

- **`@riskpilot/sdk`** (`sdk/`): `setProfile`, `subscribe` (SSE over fetch), `evaluate`,
  `verifyDecision` (EIP-712, checked with viem against the engine's Python signature), `build`,
  `execute` (simulate, then send each call) and `report`.
  - `examples/agent.ts` sets a profile, picks the best approved gap, verifies, builds, executes and
    reports: confirmed in block 26,354,385, position open.
  - `tsc --noEmit` is clean.
- **Item 8, `make hook-volatile`:** a volatile spell through the live hooked pool. The fee goes
  from 2,161 to 8,976 pips, and on the next block the engine re-prices the hooked gap from
  APPROVE (net $15.38) to REJECT (net −$52.82, fees $89.76).
- **Fix found by `make hook-volatile`:** `/v1/opportunities` served a cached block to wallets with
  no open stream. It now re-evaluates unless the cache is for the current head.

## 7 WETH call-like curve, from `POST /v1/aqua/price`

Request: spot 2,218.55, range 2,218.55–2,828.65125, call_like, 7 ETH, σ 55%.

| Figure | Value |
|---|---|
| Equivalent strike K_eq | $2,505.10 |
| Equivalent term T_eq | 6.9875 days (0.01914378 y) |
| Equivalent premium, position | $29.43 |
| C_eq per ETH | $4.204285 |
| Markup m (Moderate) | 0.20 |
| f_min | 0.201395% → Fee instruction ≥ 2,013,952 (the shipped curve's fee is exactly 2,013,952) |
| Position greeks | Δ 6.582858, Γ −0.004913, vega −2.545971, θ +10.019950 per day |
| Collateral = max loss | $15,529.85 |

## Screenshots (1440 × 900, `docs/screenshots/`)

| File | Shows |
|---|---|
| `0-profile-picker.png` | First connect: three cards, none selected |
| `1-load.png` | Loaded page |
| `2-approve-selected.png` | An APPROVE selected |
| `3-reject-selected.png` | Put-like: "Rejected: adds $629.93 worst-case loss, limit $250" |
| `4-engine-down.png` | Engine killed |
| `5-api-drawer.png` | API drawer |
| `6-load-1280x800.png` | Fit at 1280 × 800 |
| `7-profile-derivation.png` | Profile status and its derivation tooltip |
| `8-stepper.png` | The stepper ("Confirming 2 of 2…") |
| `9-confirmed.png` | Confirmed · view tx |

The console is clean on load (`capture.spec.ts` checks this).

## Acceptance checklist

| Item | Status |
|---|---|
| Fresh wallet, Moderate: budget $250 (cap) | done (e2e 0, engine tests) |
| Conservative: $150 cap | done (e2e 11) |
| DOM test: Approve and sign is the only trade control | done (e2e 9) |
| One-click call-like through Arc, settled by the worker | done on the local Arc stand-in (`arc.spec.ts`); on Arc testnet it needs `make arc-deploy` from your wallet |
| Put-like reason text | done (e2e 3) |
| Requote in place | done (e2e 4, 10) |
| Real kill test | done (e2e 7, `make outage-test`) |
| Worker restart, no double settle | done (`arc.spec.ts`, unit tests) |
| Replay of 5 | done (every seeded decision replays identical, `test_replay_of_a_profiled_decision_is_identical`; e2e 6 in the UI) |
| Latency numbers | done (table above) |
| `make demo-reset` < 30 s, same ids | done (2–5 s; the ids are checked) |
| The earlier 10 e2e tests still pass | done; updated for one action and push |
| `agent.ts` (P1) | done: `sdk/` (`@riskpilot/sdk`) and `sdk/examples/agent.ts`, run against the demo chain (see `sdk/README.md`) |
| Manual MetaMask and Rabby runs | **not done**: needs a person with the wallets. The EIP-5792 batch path is untested with a real wallet. |

## Not done, or done differently, stated plainly

- **Multicall3 is not used.** Reads are JSON-RPC batched and run in parallel, and the targets are
  met without it.
- **The per-block (block, input hash) cache** is only a per-wallet cache of the latest block's
  evaluation (it serves `/v1/opportunities` and the stream). Replay never uses it.
- **Position size** is capped at the profile's max position share. The engine does not search for
  the largest size that passes stress and edge: the Aqua curves have fixed shipped sizes, and the
  gaps are quoted at a fixed size. The cap doesn't bind for the demo wallet.
- **Uncertainty** still comes from live σ and quote latency only. Adding the quote spread would
  change the engine's maths, which this PR doesn't touch.
- **The arc-worker** follows `Funded` by `getLogs` polling every 2 s from a cursor, not a
  WebSocket subscription. The catch-up on start is the same `getLogs` path.
- **Not done:** WalletConnect (P1), and an on-chain `amountOutMinimum`. The demo router has none,
  so the page says "slippage limit … checked before sending" with a tooltip.
- **Unchanged since the earlier PR:** `docs/demo-backup.mp4` and `runthrough.spec.ts` predate this
  PR and still show the old buttons.
- **Still needs your wallet:**
  - `make testnet SENDER=0x905a…c697`, which deploys the hook to Unichain Sepolia and the escrow to
    Arc;
  - starting the engine with `ARC_OPERATOR_KEY` for testnet settlement.
- **Still to rotate:** `agents/.env` (outside `riskpilot/`) is tracked in the public repo with
  real API keys. Rotate them and untrack the file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
