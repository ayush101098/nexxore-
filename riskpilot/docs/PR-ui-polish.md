# /riskpilot: e2e suite and judging polish (PRD 6)

Branch `ui-polish`. Only `riskpilot/web/` and `riskpilot/docs/` change. Nothing under `engine/` or
`contracts/` is touched.

## How to run

The suite needs the demo chain from `contracts/aqua` and the hook pool from `contracts/hook`. Its
global setup snapshots the chain and starts the engine on :8000, which also serves the page.
Teardown reverts the snapshot, so you can rerun it as many times as you like.

```bash
cd riskpilot/contracts/aqua && export AQUA_FORK_RPC_URL=<mainnet archive RPC> && make demo-chain   # :8545, keep running
cd riskpilot/contracts/hook && make hook-pool
cd riskpilot/web && npm ci && npx playwright test riskpilot            # CI command: 8 tests, ~1 min
CAPTURE=1 npx playwright test capture        # screenshots, 1440x900 + 1280x800 fit, console clean
RUNTHROUGH=1 npx playwright test runthrough  # the ~4-minute backup run, recorded to video
```

## Part 1: tests (`web/e2e/riskpilot.spec.ts`), all green

| # | Test | Result |
|---|---|---|
| 1 | Load: 3 seeded opportunities. Price gap REJECT, put-like REJECT, call-like APPROVE | pass |
| 2 | Each decision's verdict and reason match the engine; waterfall gross − gas − slippage − fees − hedge − risk = net within $0.01 | pass |
| 3 | Put-like: stress after equals the engine's value and is over the $250 budget; Approve is disabled ("Rejected: stress over budget") | pass, see bug 1 |
| 4 | Call-like: Approve is enabled and counts down from ≤ 30 s; it disables at 0 | pass |
| 5 | Ship from the page, then a scripted taker fill: both tx hashes appear, and Verify reads success receipts | pass |
| 6 | Replay a REJECT: "identical · REJECT · net −$171.22", the same as the stored decision | pass |
| 7 | Stop the engine: all six panels show "Source unavailable: engine" within 5 s, with no $ values left and no engine-sourced status values | pass |
| 8 | Number audit, exact match | pass |

The five values test 8 compares:
- gross edge (price gap) against the engine's `gross_edge`;
- net edge (call-like) against the engine's `net_edge`;
- K_eq against the engine's `inputs.aqua.k_eq`;
- held WETH against a chain `balanceOf` call;
- the hook fee in pips against a chain `getFee` call.

## Bug list (reported, not patched in web/)

1. **The spec's put-like numbers are out of date.** Test 3 expects stress after ≈ $971, and the
   design example says "Over budget by $721".
   - **What the engine reports:** stress after **$7,729.29** (+$629.93 from this trade), "Over
     budget by $7,479.29".
   - **Why they differ:** the $971 comes from the $3,400 fixture with no wallet holdings. The demo
     now runs on the fork's real price ($2,218.55) and counts the wallet's 8 WETH in the book.
     That's correct engine behaviour, not an engine bug.
   - **Fix:** update the spec and the Pitch tab. The test asserts the engine's value.
2. **The call-like APPROVE is over budget.** Its worst loss is $7,069.93 against a $250 budget.
   - **Why it passes:** the engine's rule 4 only rejects a trade that raises the worst loss, and
     this one lowers it by $29.43.
   - **What the page shows:** "Over budget by $6,819.93, but this trade lowers the worst loss" in
     green.
   - **The risk:** a judge may still ask why an over-budget trade is approved. Either explain it in
     the pitch, or revisit whether the budget should apply to the incremental loss. That's an engine
     and product decision.
3. **The waterfall has a hedge line the spec omits.** The spec formula leaves out hedge, but the
   engine itemizes four cost lines (gas, slippage, fees, hedge), per PRD 2. The page shows all four,
   and test 2 checks the arithmetic including hedge. It's $0 on the demo's Aqua decisions and $5.00
   on the price gap.
4. **The Aqua decisions have no taker quote at size.** An unshipped curve has nothing to quote
   against, so the engine prices it at spot, from the main ETH/USDC pool via StateView. The inputs
   line says so.

## Part 2: what changed

- **Copy:** only the strings in the brief.
  - **Header:** "RiskPilot", with the subtitle "Risk and execution layer for DeFi agents".
  - **Under the header:** "Agents propose. RiskPilot prices, stress-tests and gates. You sign."
  - **Panels:** the four helper lines, exactly as given.
  - **Empty and error states:** one line, or "Source unavailable: <name>" in amber.
- **Layout:** a 12-column grid with 24px gutters, an 8px spacing scale, one 8px radius, 1px
  borders, and no shadows or glows. Opportunities spans 7 columns and Decision spans 5.
- **Fit:** at **1440 × 900** and at **1280 × 800**, the status bar, Opportunities and the whole
  Decision panel fit without scrolling. Below 880 px of height, Inputs collapses to one line.
- **Type:** Inter, plus IBM Plex Mono for hashes and addresses. `tabular-nums` applies to every
  number, and table numbers are right-aligned.
- **Formats:**
  - money as $1,234.56;
  - hook fees as "1.00% (10,000 pips)";
  - WETH to 4 decimals;
  - hashes as 0x1234…abcd with a Copy button, plus an Explorer link where one exists (see the
    out-of-scope list).
- **Tooltips:** they read "source · HH:MM:SS UTC · block N".
- **Colour:** only the verdict colours (APPROVE green, REJECT red, REQUOTE amber, REQUIRE_REVIEW
  grey), on neutral greys, with one accent for links and focus.
  - Every text colour is at least 6.3:1 on the panel surface.
  - Text on each solid chip is at least 7.3:1.
- **Components:**
  - Verdict chips are solid, uppercase and one width.
  - The waterfall has costs in red, a neutral gross bar, net in green or red against the dashed
    hurdle, and values at the bar ends.
  - Stress shows a before bar and an after bar, a dashed budget line, and the "Over budget by …" /
    "Within budget" text, with the 14 scenarios one click away.
  - The Aqua block is a 2-column key/value list with a "?" on each term, keyboard reachable.
  - The hook chart has a line for the fee, a dashed reference at 0.30%, σ on hover, and axes
    labelled in % and blocks.
  - Approve reads "Approve and sign · 23s". When disabled it says why, for example "Rejected: stress
    over budget".
  - After an approval expires, a "Re-evaluate" link reruns the engine's evaluation, so the demo
    needs no reload.
- **States:** skeleton bars on load (no spinner), the amber error state, and one-line empty states.
- **Agent API drawer:** "View API" opens a side drawer showing `POST <engine>/evaluate`. It shows
  the selected item's exact request body (`decision.inputs.request`) and the Decision JSON, each
  with Copy. The data is real; the engine is deterministic, so sending that body back returns that
  Decision. Esc closes it, and the transitions are 150 ms fades.

## Part 3 checks

- [x] **All 8 e2e tests green.** The CI command is above.
- [x] **Screenshots at 1440 × 900**, in `docs/screenshots/`:
  - `1-load.png`
  - `2-approve-selected.png`
  - `3-reject-selected.png`
  - `4-engine-down.png`
  - `5-api-drawer.png`
  - plus `6-load-1280x800.png`
- [x] **No console errors or warnings** (`capture.spec.ts` asserts this).
- [x] **Lighthouse accessibility is 100**, run with Lighthouse 12.2.1 on `/riskpilot`.
- [x] **The grep finds nothing** for AI-powered, Kelly, Autopilot, Escalation, Polymarket, paper,
  TODO or lorem in `web/`.
- [x] **The full run-through works with no reload** (`runthrough.spec.ts`, 3:39):
  1. load;
  2. the two REJECTs and the scenarios table;
  3. Re-evaluate, then Approve and sign, ship and verify;
  4. the API drawer;
  5. a taker fill and Verify;
  6. the hook σ hover;
  7. replay of a REJECT;
  8. engine down, then recovery.
- [x] **Backup video:** `docs/demo-backup.mp4` (1440 × 900, 3:39, 3.7 MB). It's a Playwright
  capture of that run, with no cursor and no voice.

## Out of scope, and what I couldn't do

- **The Pitch tab's 4-minute script** wasn't available to me. The run-through follows the PRD 6
  flow, so check it against the script and adjust the order or timing in `runthrough.spec.ts`.
- **Explorer links on the demo chain.** The Anvil fork has no block explorer, so its hashes get
  Copy only. Arc hashes get explorer links.
- **The Arc panel** shows "Source unavailable: Arc escrow (not deployed)" until `make testnet` runs
  from the owner's wallet.
- **Percent precision.** The brief says "2 decimals (0.2274%)", and the example has 4 decimals.
  Fee rates and f_min show 4 decimals, as in the example. Everything else shows 2.
- **No PR opened from here.** The `gh` CLI isn't installed, so the branch is pushed and the PR has
  to be opened from the compare link.
