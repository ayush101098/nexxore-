# Copilot Instructions for Nexxore

Keep this short, actionable, and repo-specific. Use the referenced files to understand design and make minimal, well-scoped changes.

1) Big-picture architecture
- Purpose: AI-driven DeFi research + alpha detection + multi-chain vault UI. See the overview in [README.md](../README.md) and [agents/README.md](../agents/README.md).
- Major components:
  - `agents/` — intelligence agents (research, alpha, web3-intelligence). Each agent typically has `agent.js` + `run.js` and shares utilities in `agents/shared/`.
  - `api/` — serverless/Vercel endpoints used by the frontend and agents (e.g., `api/chat.js`, `api/news.js`, `api/health.js`).
  - `contracts/` — smart contract sources (EVM under `contracts/evm/`).
  - `frontend`/root HTML files — static UI pages (e.g., `research.html`, `vault-new.html`) served during local dev via `agents/server.js`.

2) Key developer workflows & commands
- Local agent dev: `cd agents && npm install && node server.js` (server runs on http://localhost:3000). See [agents/README.md](../agents/README.md) Quick Start.
- Agent CLI runs: many agents expose `run.js` (e.g., `cd agents/alpha && node run.js --full`). Check the agent folder README first.
- Environment: create a `.env` at `agents/.env` (see example variables in `agents/README.md`). Important keys: `OPENAI_API_KEY`, `NEWS_API_KEY`, `TELEGRAM_BOT_TOKEN`.
- Deploy: Vercel uses `api/` functions — see [VERCEL_DEPLOYMENT.md](../VERCEL_DEPLOYMENT.md).

3) Project-specific conventions & patterns
- Agents share utilities in `agents/shared/` (e.g., `llmEngine.js`, `dataSources.js`, `newsFetcher.js`). If you change LLM behavior, update `agents/shared/llmEngine.js`.
- Scoring and weights live in agent code (example: `agents/alpha/agent.js` contains `calculateAlphaScore(...)` — modify weights there, not in a random file).
- CLI style: agents typically expose small CLI wrappers (`run.js`) that call `agent.js`; prefer adding CLI args here.
- Caching & performance: token lookups and protocol analyses cache results (see `agents/*` for cache durations). Keep parallel fetch patterns to preserve performance.

4) Integration points & external dependencies
- LLM: OpenAI (configured in `agents/shared/llmEngine.js`) — change model/temperature there.
- Data: NewsAPI, CoinGecko (data fetchers in `agents/shared/dataSources.js` and `agents/shared/newsFetcher.js`).
- Alerts: Telegram/X/Twitter integrations live in `agents/shared/telegramHandler.js` and `xAutomation.js`.
- Smart contracts: `contracts/evm/` — tests or migrations are not present; treat these sources as reference unless user asks to add build flows.

5) Where to look first when implementing or modifying features
- Behavior & scoring: [agents/alpha/agent.js](../agents/alpha/agent.js)
- LLM prompts or model choices: [agents/shared/llmEngine.js](../agents/shared/llmEngine.js)
- Server/API wiring: [agents/server.js](../agents/server.js) and `api/*.js`
- Dashboard/UI examples: `research.html`, `vault-new.html`, `dashboard.html` at repo root
- Docs & architecture notes: `agents/research/ARCHITECTURE.md` and [agents/README.md](../agents/README.md)

6) Examples (explicit, copyable)
- Start local dev server:
```
cd agents
npm install
node server.js
```
- Change LLM model (quick edit): open `agents/shared/llmEngine.js` and replace the `model:` field used by the OpenAI call.
- Tweak alpha weights: edit `calculateAlphaScore` in `agents/alpha/agent.js` and run `node run.js` in that folder to validate output.

7) Safety and tests
- There are no repo-wide automated tests. When adding code, run the affected agent folder manually and exercise the API endpoints via `curl`.

8) Pull request notes for human reviewers
- Keep changes scoped to a single agent or API route per PR.
- Include a short reproduction: commands to run the modified agent, env vars required, and a sample `curl` that demonstrates the change.

If anything here is unclear or you want more detail on a specific agent, tell me which area (example: `alpha scoring`, `llm prompts`, `api/chat`) and I'll expand the instructions.
