# NEXXORE monorepo

The Next.js + Turborepo rebuild of nexxore.xyz. This lives **in parallel** with
the legacy static site in the repo root — nothing in the old site was deleted.
Prompt 01 is structure only: the five product pages are ported **as-is** (their
original HTML is served from `apps/web/public/legacy/` inside a same-origin
iframe) and wrapped in the shared shell. Real per-page React rewrites happen in
later sprints.

## Workspace layout

```
nexxore-app/
├── apps/
│   ├── web/     # Next.js 14 App Router, TypeScript, Tailwind — the site
│   ├── api/     # Fastify + TypeScript API gateway (only /v1/health for now)
│   └── bot/     # grammY Telegram bot — scaffold only, NOT deployed
├── packages/
│   ├── ui/      # shared shell (Nav, Footer, RegimeChip) + regime-accent tokens
│   ├── sdk/     # typed API client (stub; generated from OpenAPI in Prompt 03)
│   └── config/  # shared eslint / tsconfig / tailwind preset
├── .github/workflows/ci.yml
└── turbo.json
```

## Prerequisites

- Node.js ≥ 20
- pnpm 9 (`corepack enable` or `npm i -g pnpm@9`)

## Install

```bash
cd nexxore-app
pnpm install
```

Copy env template (per app; values documented inline):

```bash
cp .env.example apps/web/.env.local   # NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_API_URL
cp .env.example apps/api/.env         # API_PORT (+ DATABASE_URL/REDIS_URL later)
```

## Run each app

| App | Command | URL |
|-----|---------|-----|
| Web | `pnpm --filter @nexxore/web dev` | http://localhost:3000 |
| API | `pnpm --filter @nexxore/api dev` | http://localhost:4000/v1/health |
| Bot | scaffold only — not runnable/deployed yet | — |

Or run everything via Turborepo: `pnpm dev`.

## Quality gates (what CI runs)

```bash
pnpm typecheck        # tsc --noEmit across the workspace
pnpm lint             # eslint
pnpm test             # vitest unit + api integration tests
pnpm build            # turbo build (web + api + bot)
pnpm --filter @nexxore/web link-check   # no href="#", no dead internal links
```

Playwright smoke tests (one per ported page) live in `apps/web/e2e`. They need a
built app and a browser binary:

```bash
pnpm --filter @nexxore/web build
pnpm --filter @nexxore/web exec playwright install chromium
pnpm --filter @nexxore/web test:e2e
```

## Routes

| Route | Ported from |
|-------|-------------|
| `/` | `index.html` |
| `/terminal` | `terminal.html` |
| `/predictions` | `predictions.html` |
| `/strategy` | `strategy-builder.html` |
| `/stablecoin-hub` | `stablecoin-hub.html` |
| `/vaults` | `vaults.html` |

`/proof`, `/pricing`, `/docs`, `/company`, `/status`, `/legal/*` are placeholder
(coming-soon, `noindex`) routes so nav/footer links never 404. They get real
content in Prompts 04–08.

## Regime-accent system

The site accent is driven by a `data-regime` attribute on `<html>` (see
`packages/ui/src/styles/globals.css`). Prompt 01 seeds a static `transition`
(amber) placeholder; live wiring via `RegimeProvider` + `/v1/index/current`
lands in Prompt 05. Never hardcode green/amber/red locally.
