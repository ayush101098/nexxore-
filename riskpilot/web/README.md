# web — PRD 6: the /riskpilot page

`index.html` is the demo page. It's a single file that loads viem from a CDN.
Vercel serves it at `nexxore.xyz/riskpilot`, and the engine serves it at
`http://localhost:8000/riskpilot`.

```bash
cd contracts/aqua && export AQUA_FORK_RPC_URL=<archive RPC> && make demo-chain   # chain on :8545
cd engine && DEMO_RPC_URL=http://127.0.0.1:8545 ../.venv/bin/uvicorn main:app  # engine on :8000
open http://localhost:8000/riskpilot
```

Query overrides: `?engine=<url>&rpc=<url>`.

## Layout

1. **Status bar:** fork block, chain head, wallet, held WETH and USDC, the
   Balanced profile and its $250 budget, and the engine.
2. **Opportunities and Decision, side by side.**
   - **Opportunities:** on load, `POST /demo/seed` adds three: a price gap
     (REJECT), a put-like curve (REJECT) and a call-like curve (APPROVE).
   - **Decision:** shows the verdict and reason, the net edge as a cost
     waterfall against the hurdle, the 14-scenario stress test against the
     budget, and the Aqua curve values. **Approve and sign** has a 30 s
     countdown.
3. **Positions:**
   - **Aqua curves:** the shipped status and real Aqua balances, the ship and
     fill transactions, and a **Verify** button that re-reads the receipt.
   - **v4 hook fee** and **Arc settlement:** these say "Source unavailable"
     until PRDs 4 and 5 are deployed.
4. **Decision history:** **Replay** re-runs the engine on the recorded inputs
   and checks that the result is identical.

## Sources and signing

- **Data:** every number comes from the engine API or a viem chain read. The
  tooltip on each value gives its source and timestamp. If a source fails, the
  page shows *Source unavailable: <name>* in amber rather than an old number.
- **Approve and sign:** the button signs in the browser.
  1. It runs the PRD 3 collateral check, counting curves that are already live.
  2. It approves WETH for Aqua if needed.
  3. It ships the curve order from `demo/curves.json`.
  4. It verifies the `Shipped` event and POSTs the Execution to the engine.
- **Signer:** a browser wallet connected to chain 31337 if there is one.
  Otherwise Anvil account #0, the public test key, signs locally on your click.
- **Not on this page:** no autopilot, no loop timer and no paper P&L. The user
  signs every approval.
