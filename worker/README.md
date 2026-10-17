# Edge Engine worker

Forecasts eligible Polymarket markets and settles them, writing everything to the public ledger (`alerts`) in Supabase. Runs as one long-lived container, separate from the Vercel site.

| Job | Every | What it does |
|---|---|---|
| Forecaster | `FORECAST_EVERY_MINUTES` (30) | Picks markets due for a forecast (none yet, older than 6h, or price moved ≥ 5¢), runs Bull → Bear → Judge on Claude, reads the order book at that moment, and logs the forecast whether or not it is a call |
| Resolver | `RESOLVE_EVERY_MINUTES` (60) | Settles open rows once Polymarket's oracle reports `resolved`; 50/50 and other non-binary outcomes become `void` |

## Setup

1. Run `database/ledger.sql`, then `database/ledger_v1.sql`, in the Supabase SQL editor.
2. Copy `.env.example` to your host's environment and fill it in. `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` stay on the server.
3. Build and run from the repo root (the image includes the shared `js/edge.js`):

```bash
docker build -f worker/Dockerfile -t nexxore-edge-worker .
docker run --env-file worker/.env nexxore-edge-worker
```

Railway, Fly and Render can all run this Dockerfile directly. One instance only: the jobs are not designed to run twice in parallel.

## Running once

```bash
cd worker && npm ci
npm run forecast:once   # one forecaster pass
npm run resolve:once    # one resolver pass
```

## Usage

Each run logs its token counts (`tokensIn`, `tokensOut`). There is no spend cap in the worker: set a monthly limit on the Anthropic account if you want one.

## Tests

```bash
cd worker && npm test
```
