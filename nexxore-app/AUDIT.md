# Frontend repair audit (Prompts A–D)

Surgery pass on the ported site: broken links, invalid HTML, metadata, badges,
and baked-in numbers. Every issue found and how it was resolved.

## 1. Links

| Issue | Where | Fix |
|---|---|---|
| Placeholder nav/footer targets (`/docs`, `/company`, `/status`, `/legal/*`, `/proof`, `/pricing`) | shell nav + footer | (b) real destinations: `/docs` → product-overview page; `/legal/*` → DRAFT-watermarked `noindex` pages; `/proof` → coming-soon with email capture; `/company` `/status` `/pricing` → minimal real pages (full content lands in Prompt 04) |
| `href="#"` dead links | legacy blobs `index/predictions/vaults.html` (now unused) | (c) removed — the three blobs were deleted (their routes are real React now) |
| `href="#"` inside `terminal/strategy/stablecoin-hub.html` | still-iframed legacy bodies | **tracked follow-up** — sandboxed inside their iframes; removed when each product body is rebuilt (see §7) |

Authored React source contains **zero** `href="#"` and zero dead internal
links (`link-check` + `content-check` gates, both permanent in CI).

## 2. HTML validity

| Issue | Fix |
|---|---|
| Nested `<main>` (SiteShell `<main>` + ProductShell `<main>`) | ProductShell body is now a `<div>` |
| Heading-level skip (problem cards were `<h3>` with no `<h2>`) | problem cards are `<h2>` |
| Framework `_not-found` scaffold (duplicate `<title>`, inline `<style>`) | added a custom `app/not-found.tsx` in-shell; the framework scaffold is excluded from the gate |
| No per-route h1/title guarantee | `html-validate` script asserts valid markup, exactly one `<h1>` per route, and unique `<title>` + `<meta description>` across all routes |

`html-validate` runs over all 14 prerendered content routes and is a permanent
CI step.

## 3. Metadata normalization

- One helper: `buildMeta()` in `packages/ui`. **No page defines raw meta tags.**
- Title pattern `{Page} — NEXXORE` (home overrides to `NEXXORE — Regime-Aware Capital Allocation`).
- Canonical URLs from `NEXT_PUBLIC_SITE_URL`; OG + Twitter tags; branded OG card at `/og/default.svg`.
- **Kalshi/Manifold mismatch fixed** → the correct sources are **Polymarket + Manifold**, now consistent across the predictions description, the `prediction_markets` stat source note, and the product value prop.
- Duplicate descriptions eliminated (every route has a unique description).

## 4. Badge truthing

All status claims go through the `LiveBadge` component (only `LIVE · SIMULATED · IN AUDIT · PENDING`). Hand-rolled badge markup: none in authored source.

| Product | Badge |
|---|---|
| Terminal, Predictions, Stablecoin Hub | LIVE |
| Strategy Builder | SIMULATED |
| Vaults, Proof Layer | PENDING |

## 5. Stat extraction

- Operational numbers (data streams, prediction markets, chains, product surfaces) moved to `content/stats.ts`, each with a `source` note and `verified: false` (reported) treatment.
- **Performance figures deleted**: the legacy `+18.81%` and `$1.27M` figures lived only in the removed legacy blobs. Replaced anywhere they would surface with the line _"Track record goes public soon — every number will be verifiable on-chain."_ linking to `/proof`.
- `/proof` ships an email-capture waitlist (`WaitlistForm`): POSTs to `NEXT_PUBLIC_WAITLIST_ENDPOINT` (Formspree/Tally) when set, otherwise records intent locally. No DB dependency yet — documented here and in `.env.example` when the endpoint is chosen.

## 6. Copyright / footer

Computed at render time in `Footer` (Prompt 01). Verified: no page overrides it; no typed year literals anywhere.

## 7. Known follow-ups (flagged, not silently skipped)

- **Terminal / Strategy Builder / Stablecoin Hub** bodies are still the legacy surfaces rendered in an iframe, wrapped in the new `ProductShell` chrome. Their internal UIs (map/charts/wallet, builder, data grids) are large interactive rebuilds and are the next migration step. Until then their iframe documents still contain legacy markup, numbers, and `href="#"` — sandboxed, not part of the React route's indexable content, and excluded from the source gates by design.
- `content/products.ts` marks Predictions/Stablecoin as LIVE (true in the real deployment); the rebuilt surfaces here show the shared empty state until wired to the API gateway (Prompt 03+).
