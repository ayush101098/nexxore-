# Final: the owner's address is the demo wallet, and secrets hygiene

Branch `final`. The demo runs on **Ethereum only**: a local fork of mainnet at block 26,354,292.
Arc settlement and the Unichain hook move to "What's next". Their code and tests stay, and
`ARC_REHEARSAL=1` previews Arc locally.

## 1. Demo wallet = `0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697`

**No Anvil default account is used anywhere**, since their private keys are public.

| Role | Address | How it acts on the fork |
|---|---|---|
| Demo wallet (maker of both Aqua curves) | `0x905a…c697`, the owner's | your browser wallet signs; tests impersonate it |
| Taker (`make demo-fill`) | `0x5C1E…7142` = keccak256("riskpilot demo taker") | impersonated (`--unlocked`) |
| Hook pools' LP (`make hook-pool`, `make hook-volatile`) | `0x46a9…51FD` = keccak256("riskpilot demo lp") | impersonated |
| Arc stand-in deployer (preview only) | `0x41a9…6F0e` = keccak256("riskpilot arc stand-in deployer") | impersonated |
| Arc stand-in operator (preview only) | a new key per start, kept in `.run/` (gitignored, mode 600) | the arc-worker signs with it |

Nobody holds a key for the keccak-derived addresses. They act only through Anvil impersonation.

**Funding** (`scripts/deal.sh`, called by `make demo-chain`):
- ETH via `anvil_setBalance`.
- WETH and USDC by writing their balance mappings directly: WETH9 `balanceOf` is slot 3, and
  FiatToken's balances are slot 9.
- Every write is checked with `balanceOf`.
- The demo wallet gets 992 ETH, 8 WETH and 5,000 USDC: the old demo wallet's balances, with the
  ETH rounded. 8 WETH covers the 7 WETH call-like curve.

**What else changed:**
- **Scripts:** `ShipDemoCurves` takes `MAKER` and `TakeDemoFill` takes `TAKER`, both addresses.
  `HookPool` and `HookVolatile` take `LP`. All of them broadcast with `--unlocked --sender`.
- **Page:** it no longer contains a key.
  - Signing needs an injected wallet: EIP-6963, or `window.ethereum` on chain 31337, switched or
    added automatically.
  - Without one, the page shows the demo wallet's decisions read-only, and Approve reads "Connect
    a wallet on the demo chain to sign".
- **e2e:** `stack.ts` injects a test EIP-1193 wallet.
  - It sends as the demo wallet through impersonation.
  - It can sign messages only when a test gives it a freshly generated key: the fresh-wallet
    tests 0 and 11, and the profile-picker screenshot.
- **Profile default:** the frozen demo DB records the demo wallet on Moderate as a local default.
  - `source` is "make demo-freeze: local demo default, not signed", and `GET /v1/profile` shows
    it.
  - Your wallet signing `PUT /v1/profile` replaces it.
  - The freeze now writes a clean DB. Before, it copied the running DB, which held a profile
    you'd signed (Aggressive) and a row for the old Anvil wallet.
- **Engine unit tests:** they use `Account.create()` keys and the owner's address.

**New frozen snapshot:** block 26,354,377 (demo wallet nonce 36, so nothing has been sent from
it).

| Decision id | Opportunity | Verdict | Net edge |
|---|---|---|---|
| `dec_ecbc7ffc193c1898` | Price gap · hooked v4 pool | APPROVE | $15.38 |
| `dec_c70cda4958748bfb` | Price gap · static 0.30% v4 pool | APPROVE | $7.19 |
| `dec_145c8e12af9b1774` | Price gap · v4 ETH/USDC 0.30% | REJECT | −$15.80 |
| `dec_904f027d48152d7d` | Put-like curve | REJECT: "adds $629.93 worst-case loss; limit $250" | −$314.41 |
| `dec_c212d07451bd5315` | Call-like curve | APPROVE | $5.71 |

**`make demo-reset`** restores this snapshot in 2–5 s. It then checks two things itself and fails
if either differs:
- the five ids equal `demo/frozen/ids.txt`;
- the demo wallet holds exactly 992 ETH, 8 WETH and 5,000 USDC.

The first reset after a from-scratch build took 38 s: a one-time shutdown of the build's own
Anvil, which dumps its state on exit.

## 2. Secrets hygiene

**Stopped tracking** (`git rm --cached`; the files stay on disk):
- `agents/.env`
- `backend/services/perps/.env.production` (the old ignore patterns `.env` and `*.env` missed it)

**`.gitignore`** now also has `.env.*`, with `!.env.example` and `!.env.*.example`.

**New templates** with key names and empty values:
- `agents/.env.example`
- `backend/services/perps/.env.production.example`

**History is not rewritten** and nothing was force-pushed. Every value that was ever in
`agents/.env` (NEWS_API_KEY, OPENAI_API_KEY, COINGECKO_API_KEY, TELEGRAM_BOT_TOKEN, X API keys
and tokens) or in the perps `.env.production` (DATABASE_URL, JWT_SECRET, REDIS_PASSWORD, RPC URLs,
SENTRY_DSN) is still in public history. **It must be rotated.**

### Grep results: tracked files (what the public repo publishes)

**RPC URLs with a key segment** (alchemy.com/v2/…, infura.io/v3/…, quiknode.pro/…): 18 hits, all
placeholders, no real keys.
- `.env.example`:11, 12, 15 (`your_alchemy_key`)
- `backend/.env.example`:5–9 (`YOUR_KEY`)
- `backend/agents/event_listener.py`:412, `backend/api/main.py`:34 (`your-key` defaults)
- `contracts/evm/CONTRACTS.md`:80, 93
- `frontend/js/hooks/useWeb3.ts`:34–36
- `nexxore-app/apps/web/public/legacy/frontend/js/hooks/useWeb3.ts`:34–36

Two more files set a bare `https://eth-*.g.alchemy.com/v2/` with no key:
`js/config/contracts.js`:20, 30 and its `nexxore-app/…/legacy` copy.

**`sk-` tokens:** 2 hits, both placeholders, in `backend/services/pred/.env.example`:5, 6
(`sk-your-openai-key`, `sk-ant-your-anthropic-key`). A looser pattern matched "risk-" in about 200
places; those are prose and CSS.

**`0x` + 64 hex:** 14 hits, 6 distinct values.

| Value | Where | What it is |
|---|---|---|
| `0xac0974…ff80` | `SETUP.md`:79, 142; `frontend/SETUP.md`:79, 142; `dashboard.html`:231; `frontend/dashboard.html`:207; `start.html`:300; `frontend/start.html`:299 | **Anvil default account #0's private key** (public), printed by older nexxore local-setup pages outside `riskpilot/`. Not a secret, but these pages should not tell anyone to import it. Left as-is: outside this PR's scope. |
| `0x21c67e…ca27` | `riskpilot/contracts/aqua/src/DemoParams.sol`:20, `riskpilot/engine/scanner/live.py`:41 | Uniswap v4 pool id (ETH/USDC 0.05%) |
| `0xdce639…f78d` | `riskpilot/engine/scanner/live.py`:106 | Uniswap v4 pool id (ETH/USDC 0.30%) |
| `0xddf252…b3ef` | `riskpilot/contracts/aqua/script/find_usdc_holder.py`:16 | ERC-20 `Transfer` event topic |
| `0x1111…1111`, `0x2222…2222` | `riskpilot/shared/schemas/examples/execution.example.json`:4, 7 | placeholder tx hashes |

**Other filled `*_KEY`, `*_SECRET`, `*_TOKEN` and `*_PASSWORD` assignments:**
- Placeholders (`your_…`, `YOUR…`, `<generate…>`, `$(openssl rand …)`) in about 60 docs and
  `.env.example` files.
- Concrete values:
  - `mcp-server/.env.example`:3 `POSTGRES_PASSWORD=nexxore_dev_2026`, a dev default; change it if
    it's used anywhere real;
  - `backend/services/pred/.env.example`:2 `DB_PASSWORD=pred_secret_password_change_me`.
- `agents/web3-intelligence/README.md`:210 shows a sample bot token (`123456:ABCD…`), which is the
  BotFather documentation format.
- `agents/node_modules/` is tracked in git: dotenv's README samples. Not secrets, but
  `node_modules` should not be in the repo.

### Grep results: local files that are not tracked

These exist on this machine and are gitignored. Counts only; no values are printed:

| File | Key-shaped values |
|---|---|
| `.env` | 3 RPC URLs with keys, 1 `sk-` key, 5 filled secret vars |
| `agents/.env` | 1 `sk-` key, 7 filled secret vars |
| `contracts/evm/.env` | 3 RPC URLs with keys, 1 `sk-` key, 4 filled secret vars |
| `research-bot/.env` | 14 filled secret vars |
| `riskpilot/.env` | 1 RPC URL with a key (Alchemy), 2 filled secret vars |
| `backend/services/perps/.env`, `.env.production` | 1 filled secret var each |
| `riskpilot/.run/anvil.log` | 1 Alchemy URL (Anvil prints its fork URL), and 11 hex values: Anvil's own banner of public default keys |

The running Anvil's command line also carries the Alchemy URL, visible in `ps` on this machine.

## Tests

| Suite | Result |
|---|---|
| Engine (pytest) | 91 passed |
| Schemas (pytest) | 19 passed |
| e2e `riskpilot.spec.ts` | 16 passed |
| `reset.spec.ts` (new): reset, then the wallet holds 992 ETH, 8 WETH and 5,000 USDC, the ids are the frozen ones, and the put-like reason is unchanged | passed |
| `arc.spec.ts` (Arc preview: impersonated deployer, generated operator) | passed |
| `capture.spec.ts` (console clean, fit, screenshots retaken with the new wallet) | passed |
| `make hook-volatile` (impersonated LP) | fee 2,161 → 8,976 pips |
| `sdk/examples/agent.ts` with a newly generated, `deal.sh`-funded wallet | confirmed, position open |

## Found while testing, not fixed here

**The engine doesn't check holdings for price-gap sales.** It checks Aqua curves against the
wallet, but approved a ~3.1 WETH gap sale for an agent wallet that held only 2 WETH. Nothing was
sent:
- the SDK simulates every call first, and the simulation reverted;
- the page's v4 adapter checks the balance before signing.

The engine's rule 3 should cover it (a holdings shortfall for the side being sold). That's a
verdict-rule change, so it is left for its own PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
