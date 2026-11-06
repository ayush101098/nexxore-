# Demo checklist

## Morning order

1. **`make up`** starts the Ethereum mainnet fork (:8545) and the engine (:8000). The first run
   builds the chain (about 2 min); later runs load `demo/frozen/` in seconds.
2. **`make demo-reset`** returns to the frozen block 26,354,377. It must print:
   - "same decision ids as the frozen demo";
   - "demo wallet 0x905a…c697: 992 ETH, 8 WETH, 5,000 USDC".
3. **`make preflight`**: every line must read PASS.
   - WARN for the ephemeral engine key is acceptable. Set `RISKPILOT_ENGINE_KEY` in your terminal
     to remove it.
   - Arc lines FAIL until `contracts/arc/deployments/arc-testnet.json` exists. Run
     `make arc-setup SENDER=0x905a…c697` once, before `make up`: about 4 wallet prompts.
4. **Clear MetaMask activity data.** Settings → Advanced → Clear activity tab data. The reset
   rewinds the fork, so MetaMask's cached nonce and history for chain 31337 are now wrong.
5. **Open the page:** http://localhost:8000/riskpilot. Connect the wallet on chain 31337 (RPC
   `http://127.0.0.1:8545`). The status bar should read "Moderate · budget $250 (cap)".
6. **Open the backup video in a second tab:** `docs/demo-backup.mp4`. It was recorded before the
   hardening work and shows the old buttons. Re-record it with `RUNTHROUGH=1 npx playwright test
   runthrough` once that spec is updated.

If anything goes wrong mid-demo: `make demo-reset`, then reload the page (about 3 s).

## 4-minute script

**Draft.** `docs/PITCH.md` is not in the repository, so this script is written from the current
page flow. Replace it with the pitch's script when it is added.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:20 | Header "RiskPilot: pricing liquidity risk"; five opportunities with verdicts | Risk-aware execution engine for programmable liquidity. It prices LP positions as options, stress-tests them against your wallet, and executes only what you sign. This is Ethereum mainnet, forked at block 26,354,292. |
| 0:20–0:45 | Status bar: "Moderate · budget $250 (cap)"; hover for the derivation | The profile is chosen once and signed by the wallet. The stress budget is derived each block: min(2.5% of wallet value, $250). Here the cap binds. |
| 0:45–1:20 | Select the put-like curve: REJECT; stress bars; the Aqua block (K_eq, T_eq, C_eq, f_min) | The put-like Aqua curve is priced as a cash-secured put. It adds $629.93 of worst-case loss against a $250 limit, so it is rejected, and the button says why. |
| 1:20–1:50 | The three price-gap rows; "Demo pool · seeded on fork" tags | The same $10,000 gap through three v4 pools. Our volatility hook charges 0.22% in a calm market, so it nets $15.38. The static 0.30% pool nets $7.19. Mainnet's own 0.30% pool is rejected at −$15.80. |
| 1:50–2:40 | Select the call-like curve (APPROVE, countdown); click Approve and sign | One click, five wallet prompts: approve WETH, ship, switch to Arc, approve USDC, fund. The worker settles; watch Funded → Settling → Settled. (With no Arc deployment it is two prompts, approve WETH and ship, and the settle part is skipped.) |
| 2:40–3:10 | Terminal: `make hook-volatile`; the hooked gap row on the next block | A volatile spell moves the hook fee from 2,161 to 8,976 pips. On the next block the engine re-prices the hooked gap: APPROVE becomes REJECT, with no button pressed. |
| 3:10–3:35 | Click "View API": the request and the signed decision | Any agent can do this through the API. Every decision is signed EIP-712, and `build` returns EIP-5792 calls. `sdk/examples/agent.ts` runs the whole loop. |
| 3:35–4:00 | Decision history: Replay a REJECT, "identical" | Every decision is stored with its inputs and replays identically. A decision id is a hash of the inputs, the block and the engine version. |

## Numbers to have ready

- **Latency:**
  - block to verdict on screen: 265 ms;
  - click to first wallet prompt: 57 ms;
  - `/evaluate` p95: 16.8 ms;
  - engine down to "Source unavailable": 19 ms;
  - `make demo-reset`: about 3 s.
- **Tests:** 91 engine, 19 schema, 16 e2e, plus the Arc and reset e2e. Foundry: 12 Aqua, 6 hook,
  7 escrow.
