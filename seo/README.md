# Programmatic SEO Strategy — Nexxore DeFi Analytics

## Executive Summary

This system generates **200+ SEO-optimized static HTML pages** from on-chain and market data, targeting long-tail keywords that traditional DeFi platforms ignore. Each page is a self-contained, schema-rich asset targeting a specific search intent.

**Estimated page inventory:**

| Page Type | Template | Count | Example URL |
|-----------|----------|-------|-------------|
| Funding Rate Analysis | `funding-rate.html` | 80 | `/funding-rate/bitcoin` |
| Perpetual Risk Dashboard | `perp-risk.html` | 80 | `/perp-risk/ethereum` |
| DeFi Yield Strategy | `yield-strategy.html` | 50+ | `/yield-strategy/aave` |
| Stablecoin Yield Comparison | `stablecoin-comparison.html` | 1 | `/stablecoin-yield-comparison` |

**Total: ~211 pages** (scales to 1000+ as tokens/protocols are added)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  seo/config.js                       │
│  80 tokens · 50+ protocols · 12 stablecoins · 10 ex │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│                seo/data-fetcher.js                    │
│  CoinGecko · DeFiLlama · Binance · disk cache (.seo) │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│                seo/generator.js                       │
│  Template loading · Variable replacement · HTML write │
│  Sitemap update  · Vercel rewrite rules               │
└──────────────────────┬───────────────────────────────┘
                       │
      ┌────────────────┼────────────────────┐
      ▼                ▼                    ▼
pages/funding-rate/  pages/perp-risk/  pages/yield-strategy/
  bitcoin.html         bitcoin.html       aave.html
  ethereum.html        ethereum.html      curve-dex.html
  …80 files            …80 files          …50 files
                                        pages/stablecoin-yield-comparison.html
```

**Data flow per page:**

```
config.tokens[i] → data-fetcher.fetchFundingRates(symbol)
                 → data-fetcher.fetchCoinGeckoData(coingeckoId)
                 → data-fetcher.fetchOIData(symbol)
                 → template placeholders replaced
                 → pages/{type}/{slug}.html written
                 → sitemap.xml URL appended
```

---

## Quick Start

### Generate all pages

```bash
node seo/generator.js
```

### Generate a specific page type

```bash
node seo/generator.js --type funding   # only funding-rate pages
node seo/generator.js --type perp      # only perp-risk pages
node seo/generator.js --type yield     # only yield-strategy pages
node seo/generator.js --type stable    # only stablecoin comparison
```

### Preview without writing files

```bash
node seo/generator.js --dry-run
```

### Regenerate sitemap only

```bash
node seo/generator.js --sitemap-only
```

---

## File Inventory

| File | Purpose |
|------|---------|
| `seo/config.js` | Central registry — tokens, protocols, stablecoins, exchanges, URL patterns |
| `seo/data-fetcher.js` | API clients with disk caching and mock fallbacks |
| `seo/generator.js` | Main CLI — loads templates, fetches data, renders pages |
| `seo/templates/funding-rate.html` | Template: Funding Rate Analysis for [Token] |
| `seo/templates/perp-risk.html` | Template: Perpetual Risk Dashboard for [Token] |
| `seo/templates/yield-strategy.html` | Template: DeFi Yield Strategy for [Protocol] |
| `seo/templates/stablecoin-comparison.html` | Template: Stablecoin Yield Comparison |
| `seo/README.md` | This document |

---

## Template Variables

### Funding Rate Template

| Variable | Source | Example Value |
|----------|--------|---------------|
| `{{TOKEN_NAME}}` | config.js | Bitcoin |
| `{{TOKEN_SYMBOL}}` | config.js | BTC |
| `{{CURRENT_RATE}}` | Binance API | +0.0100% |
| `{{AVG_7D}}` | Binance API | +0.0085% |
| `{{ANNUALISED_YIELD}}` | Calculated | 10.9% |
| `{{EXCHANGE_ROWS}}` | Generated HTML | `<tr>…</tr>` rows |
| `{{RELATED_TOKEN_LINKS}}` | config.js | `<a href="…">ETH</a>` links |

### Perp Risk Template

| Variable | Source | Example Value |
|----------|--------|---------------|
| `{{OI_FORMATTED}}` | CoinGlass / mock | 12.5B |
| `{{RISK_SCORE}}` | Calculated (1-10) | 5 |
| `{{RISK_CLASS}}` | Derived | risk-medium |
| `{{LS_RATIO}}` | CoinGlass / mock | 1.05 |
| `{{LIQUIDATION_ROWS}}` | Generated HTML | `<tr>…</tr>` rows |

### Yield Strategy Template

| Variable | Source | Example Value |
|----------|--------|---------------|
| `{{PROTOCOL_NAME}}` | config.js | Aave |
| `{{TVL_FORMATTED}}` | DeFiLlama | 12.5B |
| `{{TOP_APY}}` | DeFiLlama yields | 8.5% |
| `{{STRATEGY_ROWS}}` | Generated HTML | Pool comparison table |
| `{{HOW_TO_STEPS}}` | Generated | Step-by-step `<ol>` |

---

## SEO Strategy Rationale

### 1. Long-Tail Keyword Targeting

Each page targets a specific long-tail search query:

- "bitcoin funding rate today" → `/funding-rate/bitcoin`
- "ethereum perp liquidation risk" → `/perp-risk/ethereum`
- "aave yield strategy 2025" → `/yield-strategy/aave`
- "best stablecoin yield comparison" → `/stablecoin-yield-comparison`

These queries have **low competition** but **high buyer intent** — users searching these terms are active DeFi participants.

### 2. Schema Markup

Every page includes multiple JSON-LD schemas:

- **SoftwareApplication** — rich result eligibility for tools
- **FinancialProduct** — Google Finance integration
- **BreadcrumbList** — breadcrumb trail in SERPs
- **FAQPage** — FAQ rich snippets (5 Q&As per page)

### 3. Internal Linking Strategy

```
Homepage
  └─ /funding-rate/bitcoin
  │    ├─ /funding-rate/ethereum (related token)
  │    ├─ /perp-risk/bitcoin (cross-template)
  │    └─ /yield-strategy/aave (cross-category)
  └─ /yield-strategy/aave
       ├─ /yield-strategy/compound (related protocol)
       ├─ /yield-strategy/morpho (same category)
       └─ /stablecoin-yield-comparison (comparison page)
```

**Each page contains:**
- 8 related token/protocol links (same category + majors)
- 8 internal navigation links (cross-template links)
- Breadcrumb nav back to homepage
- CTA linking to Nexxore app pages

### 4. Freshness Signals

Pages include machine-readable `dateModified` timestamps. The generator should run periodically (see Automation below) to keep data fresh, signaling to Google that content is actively maintained.

---

## Scaling to Thousands of Pages

### Current: ~211 pages

```
80 tokens × 2 templates (funding + risk) = 160
50 protocols × 1 template (yield)         =  50
1 stablecoin comparison                    =   1
                                           ────
                                            211
```

### Scale path: 1,000+ pages

Add these dimensions:

| Expansion | Pages Added | Example |
|-----------|-------------|---------|
| +200 tokens | +400 | Small-cap, new launches |
| Chain-specific pages | +200 | `/yield-strategy/aave/arbitrum` |
| Time-period variants | +300 | `/funding-rate/bitcoin/7d`, `/30d` |
| Exchange-specific | +100 | `/funding-rate/bitcoin/binance` |
| Comparison pages | +50 | `/compare/aave-vs-compound` |
| Category hub pages | +10 | `/yield-strategy/lending` |

**To add new tokens:** edit `config.tokens` array in `seo/config.js` and re-run generator.

**To add new page types:** create a new template in `seo/templates/` and add a generator function in `generator.js`.

---

## Data Sources & Caching

| API | Data | Rate Limit | Cache TTL |
|-----|------|------------|-----------|
| CoinGecko (free) | Price, market cap, volume | 10-50 req/min | 1 hour |
| DeFiLlama (free) | TVL, yields, protocol info | Unlimited | 12 hours |
| Binance (free) | Funding rates | Unlimited | 4 hours |
| CoinGlass (paid) | OI, liquidations | Paid tier | 4 hours |

All fetchers fall back to **deterministic mock data** when APIs fail, so the generator always produces consistent output.

Cache is stored in `.seo-cache/` (gitignored) with configurable TTL per data type.

---

## Automation & Cron

### GitHub Actions (recommended)

```yaml
# .github/workflows/seo-generate.yml
name: Generate SEO Pages
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install --prefix seo
      - run: node seo/generator.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore(seo): refresh programmatic pages'
          file_pattern: 'pages/**'
```

### Local cron (macOS/Linux)

```bash
# Every 6 hours
0 */6 * * * cd /path/to/nexxore && node seo/generator.js >> logs/seo-gen.log 2>&1
```

### Vercel Build Hook

Configure a Vercel Deploy Hook and trigger it after generation to redeploy with fresh pages.

---

## Vercel Deployment

The generator automatically updates `vercel.json` with rewrite rules so clean URLs work:

```
/funding-rate/bitcoin → /pages/funding-rate/bitcoin.html
/perp-risk/ethereum   → /pages/perp-risk/ethereum.html
```

Vercel serves the static HTML directly — no SSR needed, which means **instant load times** and **full Core Web Vitals compliance**.

---

## Adding a New Token

1. Open `seo/config.js`
2. Add entry to `tokens` array:
   ```js
   { name: 'NewToken', symbol: 'NTK', slug: 'newtoken', coingeckoId: 'newtoken', category: 'defi' }
   ```
3. Run: `node seo/generator.js --type funding && node seo/generator.js --type perp`
4. Commit the new pages

## Adding a New Protocol

1. Open `seo/config.js`
2. Add entry to `protocols` array:
   ```js
   { name: 'NewProtocol', slug: 'newprotocol', defillamaId: 'newprotocol', category: 'lending', chains: ['Ethereum'] }
   ```
3. Run: `node seo/generator.js --type yield`
4. Commit the new page

---

## Measuring Success

### KPIs to track

| Metric | Target (3 months) | Tool |
|--------|-------------------|------|
| Indexed pages | 200+ | Google Search Console |
| Organic impressions | 10K/month | GSC |
| Long-tail rankings | Top 20 for 50+ queries | GSC / Ahrefs |
| Organic traffic | 5K visits/month | Vercel Analytics |
| CTR from SERPs | >3% average | GSC |

### Google Search Console monitoring

After deploying, submit the updated `sitemap.xml` to GSC and monitor:
1. Indexing coverage (all pages should be indexed within 2-4 weeks)
2. Rich result appearance (FAQ, breadcrumbs)
3. Search performance by page type
4. Crawl budget usage

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Thin content penalty | Pages flagged as low-quality | Each page has 800+ words of unique content, FAQs, and structured data |
| API rate limits | Generation fails | Disk caching + mock fallback ensures 100% generation success |
| Stale data | Users see outdated info | "Last updated" timestamps + 6h refresh cycle |
| Duplicate content | Pages too similar | Unique per-token data, different category templates, varied FAQ answers |
| Index bloat | Google deprioritizes site | Only generate pages for tokens/protocols with real search volume |

---

## License

Part of the Nexxore platform. See root `LICENSE`.
