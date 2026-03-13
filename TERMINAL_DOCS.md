# Nexxore Terminal v3 — Full Documentation

> **Bloomberg-Grade Crypto Intelligence & Geopolitical Monitor**
> Live at: [nexxore.xyz/terminal](https://nexxore.xyz/terminal)
> Version: 3.0 | 1,355 lines | Vanilla HTML/CSS/JS | Zero build step

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Layout & Grid System](#layout--grid-system)
4. [Panel Breakdown](#panel-breakdown)
   - [Boot Sequence](#1-boot-sequence)
   - [Top Bar](#2-top-bar)
   - [Ticker Tape](#3-ticker-tape)
   - [Alert Bar](#4-alert-bar)
   - [Global News Feed](#5-global-news-feed-left-panel)
   - [Geopolitical & Supply Chain Map](#6-geopolitical--supply-chain-map-center)
   - [Markets Panel — Indices / Crypto / F&G](#7-markets-panel-right-top)
   - [AI Signals & Correlations](#8-ai-signals--correlations-bottom-left)
   - [Macro & Supply Chain](#9-macro--supply-chain-right-bottom)
   - [Command Palette](#10-command-palette-k)
5. [Data Sources & APIs](#data-sources--apis)
6. [Geopolitical Monitor — Deep Dive](#geopolitical-monitor--deep-dive)
7. [Crypto Price Driver Framework](#crypto-price-driver-framework)
8. [Correlation Matrix](#correlation-matrix)
9. [Design System](#design-system)
10. [Refresh Intervals](#refresh-intervals)
11. [Keyboard Shortcuts](#keyboard-shortcuts)
12. [Responsive Behavior](#responsive-behavior)
13. [Deployment](#deployment)
14. [Limitations & Future Work](#limitations--future-work)

---

## Overview

Nexxore Terminal v3 is a single-file, client-side Bloomberg-grade intelligence dashboard purpose-built for crypto traders who need to understand the **macro, geopolitical, and supply chain factors that drive crypto prices**.

Unlike typical crypto dashboards that show only prices and charts, Nexxore Terminal answers the question: **"Why is BTC moving?"** — by surfacing the upstream causes: Fed decisions, shipping lane disruptions, yield curve inversions, oil spikes from Houthi attacks, DXY strength, M2 money supply expansion, and more.

### Key Differentiators

| Feature | Typical Terminal | Nexxore Terminal v3 |
|---------|-----------------|---------------------|
| Crypto prices | ✅ | ✅ 15 coins + sparklines |
| Global indices | ❌ or limited | ✅ 18 indices (Nifty, Sensex, Nikkei, FTSE, DAX, Hang Seng, etc.) |
| Shipping lanes on map | ❌ | ✅ 8 major routes with animated ships |
| Maritime chokepoints | ❌ | ✅ 8 chokepoints with live status |
| Conflict zones + market impact | ❌ | ✅ 10 zones with crypto impact analysis |
| Sanctions tracker | ❌ | ✅ 5 sanctioned regions + crypto evasion notes |
| Correlation matrix | ❌ | ✅ 7×7 cross-asset (BTC/ETH/SOL/GOLD/OIL/DXY/VIX) |
| Crypto price driver ranking | ❌ | ✅ 12 factors with correlation scores |
| Supply chain data (BDI, container rates) | ❌ | ✅ Full shipping economics |
| Central bank tracker (6 banks) | ❌ | ✅ Fed, ECB, BOJ, BOE, RBI, PBOC |
| Crypto-specific macro (stablecoin supply, hash rate, funding, basis) | Partial | ✅ Full suite |
| News → crypto impact badges | ❌ | ✅ Every headline tagged ₿ BULLISH/BEARISH/NEUTRAL |

---

## Architecture

```
terminal.html (1,355 lines — single file)
├── <style>     ~360 lines of CSS
├── <body>      ~130 lines of HTML structure
└── <script>    ~860 lines of JavaScript engine
    ├── Boot sequence
    ├── Helpers (fmt, fmtPct, fmtK, timeSince, fetchJ, apiFetch)
    ├── Ticker tape (Binance API + curated macro)
    ├── Alert bar (dynamic alerts from market state)
    ├── News engine (9 RSS feeds via allorigins proxy)
    ├── AI signal generator (headline sentiment + live prices)
    ├── Market panel (indices / crypto / F&G — tabbed)
    ├── Map engine (Leaflet.js + 7 toggleable layers)
    │   ├── Conflicts (10 zones with market impact)
    │   ├── Shipping lanes (8 routes with animated ships)
    │   ├── Chokepoints (8 maritime bottlenecks)
    │   ├── Sanctions (5 zones)
    │   ├── Energy hubs (8 locations)
    │   ├── Earthquakes (USGS live feed)
    │   └── Weather events (5 tracked)
    ├── Signals + Correlation + Drivers (tabbed panel)
    ├── Macro + Supply chain (2-column)
    └── Command palette (⌘K)
```

### Dependencies

| Dependency | Version | Purpose | Source |
|-----------|---------|---------|--------|
| Leaflet.js | 1.9.4 | Interactive world map | unpkg CDN |
| Google Fonts | — | JetBrains Mono, Inter, IBM Plex Mono, Space Grotesk | fonts.googleapis.com |
| CartoDB Dark Tiles | — | Dark map basemap | basemaps.cartocdn.com |

**No build tools. No React. No npm. No bundler.** Pure vanilla HTML/CSS/JS deployed as a static file on Vercel.

---

## Layout & Grid System

The terminal uses a CSS Grid with 5 panels arranged in a 3-column, 2-row layout:

```
┌──────────────┬────────────────────────────┬──────────────┐
│              │                            │              │
│   NEWS       │       GEOPOLITICAL         │   MARKETS    │
│   FEED       │       & SUPPLY CHAIN       │   (Indices/  │
│   (left)     │       MAP                  │    Crypto/   │
│              │       (center, full height) │    F&G)      │
│              │                            │              │
├──────────────┤                            ├──────────────┤
│              │                            │              │
│   AI SIGNALS │                            │   MACRO &    │
│   & CORR     │                            │   SUPPLY     │
│   (bot-left) │                            │   CHAIN      │
│              │                            │   (bot-right)│
└──────────────┴────────────────────────────┴──────────────┘
```

```css
grid-template-columns: 1fr 2.2fr 1fr;
grid-template-rows: 1fr 1fr;
grid-template-areas:
  "left       map        right-top"
  "bottom-left map        right-bottom";
```

The map spans full center height (both rows) — this is the hero element of the terminal.

### Vertical Stack (Top to Bottom)

1. **Top Bar** — 32px — Branding, nav, region tabs, search, clock
2. **Ticker Tape** — 22px — Scrolling prices (crypto + indices + macro)
3. **Alert Bar** — 20px — Scrolling market alerts
4. **Main Grid** — `calc(100vh - 74px)` — The 5-panel grid

---

## Panel Breakdown

### 1. Boot Sequence

A cinematic startup sequence that plays for 2.4 seconds on page load:

```
NEXXORE TERMINAL v3.0
═══════════════════════════════════════
▸ Connecting to 12 global exchanges...
▸ Loading geopolitical OSINT feeds...
▸ Mapping 8 maritime chokepoints...
▸ Tracking shipping lanes & BDI...
▸ Calibrating macro correlation engine...
▸ Indexing Nifty · Nikkei · FTSE · DAX...
▸ Initializing AI signal pipeline...
═══════════════════════════════════════
● ALL SYSTEMS NOMINAL — 47 DATA STREAMS LIVE
[████████████████████████] 100%
```

Each line fades in sequentially (120ms + i×180ms). A progress bar fills in sync. After 2.4s, the boot screen fades out (opacity 0 → visibility hidden) revealing the terminal.

### 2. Top Bar

| Element | Position | Details |
|---------|----------|---------|
| Logo + Brand | Left | Green dot (pulsing) + "NEXXORE TERMINAL" in Space Grotesk |
| Version badge | Left | `v3.0` in bordered pill |
| Nav links | Left | Home, Analyst, Strategy, Perps |
| Region tabs | Center | GLOBAL, AMERICAS, EUROPE, ASIA, **INDIA**, MENA |
| Search trigger | Center | `⌕ Search` + `⌘K` kbd badge |
| Live status | Right | Pulsing green dot + "LIVE" |
| UTC Clock | Right | Updates every 1 second |
| Trade button | Right | Links to Strategy Builder |

**Region tabs** do two things:
1. Filter news feed by region
2. Fly the map to that region (e.g., INDIA → centers on [22, 78] zoom 5)

### 3. Ticker Tape

A continuously scrolling horizontal tape (100s animation, pauses on hover) showing:

**Crypto (16 tokens via Binance API):**
BTC, ETH, BNB, SOL, XRP, DOGE, ADA, AVAX, DOT, LINK, SUI, NEAR, AAVE, LTC, MATIC, TON

**Global Indices (10 — curated):**
S&P 500, NASDAQ, DOW, Nifty 50, Sensex, Nikkei, FTSE, DAX, Hang Seng, Shanghai

**Macro (8 — curated):**
DXY, Gold, Oil, US 10Y, VIX, BDI (Baltic Dry Index), EUR/USD, USD/INR

Sections are separated by violet `│ INDICES │` and `│ MACRO │` dividers. The track is duplicated (innerHTML + innerHTML) for seamless infinite scroll.

### 4. Alert Bar

A horizontally scrolling alert ticker (30s animation) showing dynamic market alerts:

- 🔴 Fear & Greed extreme warnings
- ⚠ Yield curve inversion status
- 🌍 Red Sea / Houthi shipping disruption
- 🚢 Panama Canal drought restrictions
- 📊 BDI movement signals
- 🏛 Next FOMC meeting + rate cut probability
- 🇮🇳 RBI repo rate + Nifty support levels

Alert bar color changes based on F&G: red (≤20), green (≥80), amber (default).

### 5. Global News Feed (Left Panel)

**9 RSS Sources:**

| Source | Feed URL | Regions | CSS Class |
|--------|----------|---------|-----------|
| Reuters | feeds.reuters.com/reuters/businessNews | GLOBAL, AMERICAS, EUROPE | `s-reuters` |
| BBC | feeds.bbci.co.uk/news/business/rss.xml | GLOBAL, EUROPE | `s-bbc` |
| CNBC | cnbc.com/id/100003114/device/rss/rss.html | GLOBAL, AMERICAS | `s-cnbc` |
| MarketWatch | feeds.marketwatch.com/marketwatch/topstories/ | GLOBAL, AMERICAS | `s-mw` |
| CoinDesk | coindesk.com/arc/outboundfeeds/rss/ | GLOBAL | `s-coindesk` |
| CoinTelegraph | cointelegraph.com/rss | GLOBAL | `s-ct` |
| The Block | theblock.co/rss.xml | GLOBAL | `s-block` |
| ET Markets | economictimes.indiatimes.com/markets/rss | GLOBAL, INDIA, ASIA | `s-et` |
| Nikkei Asia | asia.nikkei.com/rss/feed/nar | GLOBAL, ASIA | `s-nikkei` |

Plus **CoinGecko Trending** (top 4 trending coins injected as news items).

**Filter Tabs:** ALL | MKTS | FED | GEO | SHIP | CMDTY | CRYPTO | INDIA

**Classification Engine:**

Every headline is classified by three systems:

1. **Category** — Regex-based keyword matching:
   - SHIPPING: `shipping|freight|vessel|tanker|port|canal|suez|panama|hormuz|malacca|strait|maritime|container|dry bulk|BDI|reroute|piracy|houthi`
   - CRYPTO: `bitcoin|btc|ethereum|eth|crypto|defi|nft|token|solana|blockchain|binance|coinbase`
   - FED: `fed|fomc|powell|rate hike|rate cut|treasury|central bank|monetary|ecb|boj`
   - GEOPOLITICS: `war|conflict|sanctions|geopolit|military|nato|china.*taiwan|russia|iran|missile|attack|houthi`
   - INDIA: `nifty|sensex|bse|nse|rbi|india|rupee|adani|reliance|tata`
   - COMMODITIES: `oil|gold|silver|commodity|wheat|corn|natural gas|copper|crude`
   - MARKETS: (default fallback)

2. **Impact Level** — HIGH / MED / LOW:
   - HIGH: `war|crash|fed rate|rate hike|rate cut|sanctions|default|collapse|surge|plunge|bankrupt|crisis|attack|missile|nuclear|recession|emergency|panic|houthi|blockade|embargo|invasion|coup`
   - MED: `earnings|inflation|GDP|trade deal|merger|acquisition|IPO|unemployment|tariff|stimulus|FOMC|treasury|bond|yield|CPI|shipping|freight|port|canal|pipeline|nifty|sensex|RBI|BOJ|ECB`
   - LOW: (everything else)

3. **Crypto Impact** — ₿ BULLISH / ₿ BEARISH / ₿ NEUTRAL:
   - Bullish: `crypto.*bull|bitcoin.*surge|btc.*rally|rate cut|dovish|stimulus|adoption|etf.*approv|institutional|inflow|halving|upgrade`
   - Bearish: `crypto.*crash|bitcoin.*ban|btc.*plunge|rate hike|hawkish|sanctions.*crypto|regulation|hack|exploit|outflow|sell.off`
   - Neutral: (everything else)

**Time Grouping:** News items are grouped into "LAST HOUR", "TODAY", and "EARLIER" sections.

### 6. Geopolitical & Supply Chain Map (Center)

The crown jewel of the terminal. A full-height Leaflet.js interactive map with **7 toggleable layers** and 49+ map objects.

#### Layer: 🔴 Conflicts (10 Zones)

| Zone | Coordinates | Market Impact | Radius |
|------|------------|---------------|--------|
| Ukraine-Russia War | 48.5°N, 35.5°E | Energy & grain supply disruption. Oil ↑, sanctions boost crypto adoption | 180km |
| Gaza Conflict | 31.4°N, 34.4°E | Red Sea shipping rerouted. Houthi attacks. +15 days transit via Cape | 120km |
| Yemen / Houthi | 23.0°N, 57.0°E | Attacks on shipping in Red Sea & Gulf of Aden. Insurance 10x. Major crypto driver via oil | 120km |
| Sudan Civil War | 15.5°N, 32.5°E | 2nd largest displacement. Gold mining disruption | 150km |
| Myanmar Military | 19.8°N, 96.2°E | Civil unrest, jade & gem trade disruption | 100km |
| Taiwan Strait Tensions | 23.5°N, 120.5°E | 50% of world container ships transit here. Escalation = global supply chain collapse | 150km |
| Korean Peninsula | 38.5°N, 128.0°E | DPRK missile tests. Regional risk premium | 80km |
| Iraq Militia Activity | 33.3°N, 44.3°E | Iran-backed militia attacks. Oil infrastructure risk | 100km |
| South China Sea | 13.0°N, 122.0°E | Philippines-China maritime disputes. Shipping lane risk | 200km |
| Ethiopia Regional | 9.0°N, 38.7°E | Tigray aftermath, Amhara insurgency | 100km |

Each conflict renders as:
- A red dashed circle (semi-transparent) showing the affected zone
- A pulsing red dot marker at the center
- A popup with name, detailed analysis, and **MARKET IMPACT: HIGH/MED/LOW** badge

#### Layer: 🚢 Shipping Lanes (8 Routes)

| Route | Color | Key Points | Trade Volume |
|-------|-------|------------|-------------|
| Asia-Europe (Suez) | Cyan | Singapore → Sri Lanka → Red Sea → Suez → Med → London | 65% of Asia-Europe trade, 12% global |
| Asia-Europe (Cape Route) | Orange | Singapore → Indian Ocean → Cape of Good Hope → London | Suez alternative. +15 days, +$1M fuel/vessel |
| Trans-Pacific | Green | Hong Kong → Pacific → Los Angeles | $1.2T annually. China-US decoupling risk |
| Persian Gulf Oil Route | Red | Hormuz → Gulf of Aden | 21% of global oil (21M bbl/day) |
| Malacca Strait | Amber | Singapore → Penang → Myanmar | 25% of global trade. 60% China oil imports |
| Panama Canal | Violet | Panama → Caribbean → US East Coast | 5% of global trade. Drought restricted |
| North Sea / Baltic | Cyan | London → Norway → Baltic | European energy trade. Russian oil sanctions rerouting |
| Indian Ocean (India) | Pink | Mumbai → Arabian Sea → Gulf of Aden | India crude imports. 85% import dependent |

Each route renders as:
- A colored polyline on the map
- Animated 🚢 emoji markers at the midpoint of each route
- Clickable popups with trade volume and disruption analysis

#### Layer: ⚓ Chokepoints (8 Maritime Bottlenecks)

| Chokepoint | Status | Key Data |
|-----------|--------|----------|
| **Suez Canal** (30°N, 32.5°E) | ⚠ DISRUPTED | 12% global trade. 2.5M bbl/day oil. Houthi attacks forcing reroutes. Insurance +1000% |
| **Strait of Hormuz** (26.5°N, 56.3°E) | ⚠ ELEVATED RISK | 21% global oil (21M bbl/day). Iran closure = oil doubles instantly |
| **Strait of Malacca** (1.3°N, 103.8°E) | ● OPERATIONAL | 25% global trade. 16M bbl/day oil. China lifeline. Piracy risk |
| **Panama Canal** (9°N, 79.5°W) | ⚠ RESTRICTED | 5% global trade. Drought: 24 transits/day (vs 36-40 normal). $4B revenue at risk |
| **Bab el-Mandeb** (12.6°N, 43.3°E) | 🔴 HIGH RISK | Gateway to Red Sea. 4.8M bbl/day oil. Houthi drone/missile attacks |
| **Cape of Good Hope** (34.5°S, 18.5°E) | ● HEAVY TRAFFIC | Suez alternative. +15 days transit. +$1M fuel. 2x normal traffic |
| **Danish Straits** (61°N, 28°E) | ⚠ MONITORING | Baltic Sea access. Russian "shadow fleet" tanker transits. Sanctions evasion |
| **Turkish Straits** (41.2°N, 29°E) | ● OPERATIONAL | Bosphorus & Dardanelles. Black Sea grain/oil |

#### Layer: 🚫 Sanctions Zones (5 Regions)

| Region | Key Details |
|--------|------------|
| **Russia** | SWIFT disconnect, oil price cap $60/bbl, tech export ban. Shadow fleet via India. Crypto adoption surging for evasion |
| **Iran** | Oil embargo, SWIFT disconnected, nuclear sanctions. Oil sold to China at discount via "dark fleet" |
| **North Korea** | Full trade embargo. $1.7B in crypto stolen via Lazarus Group. Major crypto hack threat |
| **China (Tech)** | Chip export controls (ASML/TSMC). Trade war tariffs. De-dollarization push. CBDC digital yuan |
| **UAE (Monitoring)** | Russian money flows. Gold trade hub. Crypto adoption hub (Dubai). AML scrutiny |

#### Layer: ⚡ Energy Hubs (8 Locations)

Saudi Arabia (Ghawar), Kuwait/Iraq Oil, Qatar LNG, West Siberia Oil, Houston (US Energy), Rotterdam, Singapore, Mumbai (Jamnagar refinery)

#### Layer: 🟠 Seismic (USGS Live)

Live earthquake data from USGS GeoJSON feed — all M4.5+ earthquakes in the past 24 hours. Circle markers scaled by magnitude.

#### Layer: 🌪 Weather Events (5 Tracked)

Atlantic tropical storms, W. Pacific typhoons, Bangladesh flooding, Indonesia volcanic activity, California wildfires — each with supply chain impact notes.

#### Map Controls

- **7 toggle buttons** (top-right): Click to show/hide each layer
- **Legend** (bottom-left): Color-coded layer key
- **Stats bar** (top-left): Live counts — conflicts, routes, quakes
- **Region fly-to**: Clicking region tabs zooms the map

### 7. Markets Panel (Right Top)

Three tabbed views:

#### Tab: INDICES (18 Global Markets)

| Flag | Index | Region |
|------|-------|--------|
| 🇺🇸 | S&P 500, NASDAQ, DOW JONES, RUSSELL 2K | US |
| 🇮🇳 | **NIFTY 50, SENSEX, BANK NIFTY** | India |
| 🇯🇵 | NIKKEI 225 | Japan |
| 🇬🇧 | FTSE 100 | UK |
| 🇩🇪 | DAX 40 | Germany |
| 🇫🇷 | CAC 40 | France |
| 🇭🇰 | HANG SENG | Hong Kong |
| 🇨🇳 | SHANGHAI COMPOSITE | China |
| 🇰🇷 | KOSPI | South Korea |
| 🇦🇺 | ASX 200 | Australia |
| 🇸🇬 | STI | Singapore |
| 🇧🇷 | BOVESPA | Brazil |
| 🇸🇦 | TADAWUL | Saudi Arabia |

Each row shows: flag, name, price, mini SVG sparkline (10-point), % change.

#### Tab: CRYPTO (15 Coins)

BTC, ETH, BNB, XRP, SOL, ADA, DOGE, DOT, AVAX, LINK, TRX, NEAR, SUI, UNI, AAVE

Data from CoinGecko Markets API with 7-day sparklines. Header shows BTC dominance and total market cap.

#### Tab: F&G (Fear & Greed)

- Giant F&G number (42px font)
- Classification label (EXTREME FEAR / FEAR / NEUTRAL / GREED / EXTREME GREED)
- Gradient gauge bar with needle
- Contextual analysis text (what F&G level means for trading)
- Market stats: BTC dominance, total market cap, stablecoin supply, BTC hash rate

### 8. AI Signals & Correlations (Bottom Left)

Three tabbed views:

#### Tab: SIGNALS (7 Assets)

| Asset | Data Source | Signal Logic |
|-------|-----------|-------------|
| BTC/USD | Nexxore API (live spot, funding) | Headline sentiment + 24h change + funding rate |
| ETH/USD | Nexxore API | 24h change + DeFi narrative detection |
| SOL/USD | Nexxore API | High beta L1, momentum signals |
| NIFTY 50 | Curated | FPI flow analysis + RBI rate + headline sentiment |
| GOLD (XAU) | Curated | Safe-haven flow detection from geopolitical headlines |
| CRUDE OIL (WTI) | Curated | Supply disruption detection (Suez/Hormuz/OPEC) |
| DXY (USD) | Curated | Fed hawkish/dovish headline analysis |

Each signal shows:
- Asset name + live price
- BUY / SELL / HOLD badge
- Reasoning text
- Confidence bar (0-100%)
- Timeframe badge (SWING / INTRADAY / MACRO)
- **Driver tags** — small pills showing what macro factors affect the asset

#### Tab: CORR MATRIX (7×7 Cross-Asset)

A visual correlation matrix showing 90-day rolling correlations between:

**BTC, ETH, SOL, GOLD, OIL, DXY, VIX**

| | BTC | ETH | SOL | GOLD | OIL | DXY | VIX |
|---|---|---|---|---|---|---|---|
| **BTC** | 1.00 | 0.89 | 0.82 | 0.15 | -0.05 | **-0.72** | -0.45 |
| **ETH** | 0.89 | 1.00 | 0.85 | 0.10 | -0.08 | -0.65 | -0.40 |
| **SOL** | 0.82 | 0.85 | 1.00 | 0.05 | -0.03 | -0.58 | -0.48 |
| **GOLD** | 0.15 | 0.10 | 0.05 | 1.00 | 0.20 | -0.55 | 0.35 |
| **OIL** | -0.05 | -0.08 | -0.03 | 0.20 | 1.00 | -0.15 | 0.25 |
| **DXY** | **-0.72** | -0.65 | -0.58 | -0.55 | -0.15 | 1.00 | 0.30 |
| **VIX** | -0.45 | -0.40 | -0.48 | 0.35 | 0.25 | 0.30 | 1.00 |

Color-coded: green (positive >0.3), red (negative <-0.3), grey (neutral).

**Key Insights Panel:**
- BTC/DXY: Strong inverse (-0.72) — Dollar weakness = BTC strength
- BTC/VIX: Negative (-0.45) — Risk-off = crypto selloff
- BTC/ETH: Very high (0.89) — ETH follows BTC with higher beta
- Shipping disruptions → Oil ↑ → Inflation ↑ → Hawkish Fed → DXY ↑ → BTC ↓

#### Tab: PRICE DRIVERS (12 Factors)

The definitive ranking of what moves BTC:

| # | Factor | Impact | Direction | Score | Explanation |
|---|--------|--------|-----------|-------|-------------|
| 1 | **M2 Money Supply** | HIGH | DIRECT | +0.85 | #1 long-term BTC driver. More money printed = BTC higher |
| 2 | **Stablecoin Supply** | HIGH | DIRECT | +0.78 | USDT/USDC mint = dry powder entering crypto |
| 3 | **US Dollar (DXY)** | HIGH | INVERSE | -0.72 | Strongest macro driver. DXY ↑ = BTC ↓ |
| 4 | **Fed Rate Decisions** | HIGH | INVERSE | -0.68 | Rate hikes = tighter liquidity = risk-off |
| 5 | **BTC Miner Revenue** | MED | DIRECT | +0.55 | Hash rate ↑ + revenue ↑ = bullish |
| 6 | **VIX (Fear Index)** | HIGH | INVERSE | -0.45 | VIX spike = equity selloff = crypto sells harder |
| 7 | **US 10Y Yield** | MED | INVERSE | -0.38 | Higher yields = higher opportunity cost for BTC |
| 8 | **Suez/Hormuz Risk** | HIGH | BEARISH | -0.30 | Chokepoint disruptions spike oil → inflation → hawkish Fed → DXY ↑ → BTC ↓ |
| 9 | **Nifty/EM Flows** | LOW | MILD POS | +0.20 | FPI outflows from India/EM sometimes flow to crypto |
| 10 | **Gold (XAU)** | MED | MILD POS | +0.15 | Both "hard money" narratives |
| 11 | **Shipping / BDI** | MED | INDIRECT | +0.10 | Shipping disruptions → supply chain inflation → central bank response |
| 12 | **Crude Oil (WTI)** | MED | INDIRECT | -0.05 | Oil spikes → inflation → hawkish Fed → DXY up → BTC down |

Each factor shows a visual bar proportional to its absolute correlation score.

### 9. Macro & Supply Chain (Right Bottom)

Two-column layout:

#### Column 1: Central Banks & Rates

**Central Banks (6):**
- Fed Funds Rate: 5.25–5.50% (Next: Mar 18-19)
- ECB Deposit Rate: 4.50% (Next: Apr 11)
- BOJ Rate: 0.10% (YCC abandoned)
- BOE Rate: 5.25% (Next: Mar 20)
- RBI Repo Rate: 6.50% (Next MPC: Apr 7-9)
- PBOC LPR: 3.45%

**US Macro:**
- US 10Y Yield, US 2Y Yield, 2Y/10Y Spread (INVERTED flag), CPI, Core PCE, Unemployment, DXY, M2 Money Supply

**Crypto-Specific Macro:**
- BTC Funding Rate (live from Nexxore API)
- Stablecoin Supply ($172.8B)
- BTC Hash Rate (620 EH/s)
- ETH Staking APR (3.8%)
- CME BTC Basis (+5.2% annualized)
- GBTC Premium (-1.2%, narrowing)

#### Column 2: Supply Chain & Shipping

**Shipping Data:**
- Baltic Dry Index (BDI): 1,842 (+2.5%)
- Shanghai CCFI: 1,156 (+3.2%)
- Suez Canal Transits: ~30/day (-25% vs normal)
- Panama Canal Transits: 24/day (-40%, drought)
- Container 40ft Asia-EU: $4,200 (+180% vs $1,500 normal)
- VLCC Tanker Rate: $48K/day (+35%)
- Red Sea Insurance: +0.7% (+1000% war risk premium)

**Commodities:**
Gold, Silver, Crude Oil (WTI), Brent, Natural Gas, Copper

**FX Pairs:**
EUR/USD, USD/JPY, GBP/USD, USD/INR, USD/CNY

**Volatility:**
VIX (CBOE), MOVE (Bond Vol), DVOL (Deribit BTC Vol)

### 10. Command Palette (⌘K)

A VS Code-style command palette with:

- **Static commands**: BTC, ETH, SOL, Nifty 50, Sensex, Strategy Builder, Analyst, Perps, Safe Yield, Shipping Routes, Geopolitical Map, Homepage
- **Dynamic search**: Searches across news headlines, AI signals, and crypto data in real-time
- **AI Briefing**: If no exact match, pressing Enter generates a typewriter-animated market briefing incorporating BTC price, ETH price, F&G, BDI, Red Sea status, DXY, VIX, yield curve, Nifty, and top headlines
- **Keyboard navigation**: ↑↓ to navigate, Enter to select, Esc to close

---

## Data Sources & APIs

| Source | Endpoint | Data | Refresh |
|--------|----------|------|---------|
| **Binance** | api.binance.com/api/v3/ticker/24hr | 16 crypto prices + 24h change | 30s |
| **CoinGecko Markets** | api.coingecko.com/api/v3/coins/markets | 15 coins with 7d sparklines | 45s |
| **CoinGecko Trending** | api.coingecko.com/api/v3/search/trending | Top 4 trending coins | 90s |
| **CoinGecko Global** | api.coingecko.com/api/v3/global | BTC dominance, total mcap | 45s |
| **Alternative.me** | api.alternative.me/fng/?limit=1 | Fear & Greed Index | 45s |
| **USGS** | earthquake.usgs.gov/.../4.5_day.geojson | M4.5+ earthquakes (24h) | On init |
| **Nexxore API** | /api/options-data?action=ticker | BTC/ETH/SOL live spot, funding | 90s |
| **AllOrigins Proxy** | api.allorigins.win/get?url=... | RSS feed CORS proxy | 90s |
| **9 RSS Feeds** | Various (Reuters, BBC, CNBC, etc.) | Global news headlines | 90s |
| **CartoDB** | basemaps.cartocdn.com/dark_all/ | Dark map tiles | Static |

---

## Design System

### Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#060610` | Deepest background |
| `--bg2` | `#0a0a16` | Panel headers |
| `--surface` | `#12122a` | Hover states, inputs |
| `--accent` | `#00ff88` | Primary brand green |
| `--cyan` | `#00C8FF` | Shipping lanes, links |
| `--green` | `#00E87A` | Positive values, buy signals |
| `--red` | `#FF3D5A` | Negative values, sell signals, conflicts |
| `--amber` | `#f0b429` | Warnings, medium impact |
| `--violet` | `#8b5cf6` | Sanctions, timeframe badges |
| `--gold` | `#E8A020` | Hold signals |

### Typography

| Font | Weight | Usage |
|------|--------|-------|
| JetBrains Mono | 300-700 | Primary monospace (all data) |
| IBM Plex Mono | 300-600 | Fallback monospace |
| Inter | 300-700 | Body text (not heavily used) |
| Space Grotesk | 500-700 | Display text (logo, F&G number) |

### Visual Effects

- **Scanline overlay**: Subtle CRT-style horizontal lines (opacity 0.25)
- **Scrollbar**: 3px wide, dark track, green thumb on hover
- **Animations**: `slideIn` (fade + translateY), `flashG`/`flashR` (price flash), `pulse` (live dots)
- **Backdrop blur**: 8px on command palette overlay

---

## Refresh Intervals

| Data | Interval | Rationale |
|------|----------|-----------|
| Ticker tape (crypto prices) | 30s | Price sensitivity |
| Crypto panel + F&G + global | 45s | CoinGecko rate limits |
| News feeds (9 RSS + trending) | 90s | RSS update frequency |
| Macro & supply chain | 120s | Slow-moving data |
| UTC Clock | 1s | Real-time display |
| Map (earthquakes) | On init only | USGS updates hourly |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Open command palette |
| `Esc` | Close command palette |
| `↑` / `↓` | Navigate command results |
| `Enter` | Select result or trigger AI briefing |

---

## Responsive Behavior

| Breakpoint | Layout Change |
|-----------|---------------|
| > 1200px | Full 3-column grid (1fr / 2.2fr / 1fr) |
| 900-1200px | Compressed 3-column (1fr / 1.5fr / 1fr) |
| < 900px | Single column stack: Map → News → Signals → Markets → Macro. Top bar center hidden. Each panel 45-50vh height with vertical scroll |

---

## Deployment

| Aspect | Detail |
|--------|--------|
| **Hosting** | Vercel (auto-deploy from GitHub `main`) |
| **Repository** | github.com/ayush101098/nexxore- |
| **URL** | https://nexxore.xyz/terminal |
| **Build** | None (static HTML file) |
| **CDN** | Vercel Edge Network |
| **SSL** | Automatic via Vercel |
| **File size** | ~45KB (uncompressed) |

---

## Limitations & Future Work

### Current Limitations

1. **Index prices are curated/static** — Nifty, Sensex, S&P, etc. show representative values, not live API data. No free API covers all 18 indices without rate limits.
2. **Macro data is curated** — Fed rate, CPI, BDI, container rates, etc. are manually set values representing current levels. Would need a backend scheduler for true live data.
3. **Commodities are curated** — Gold, Oil, etc. show representative values. Live commodity APIs require paid subscriptions (Commodities API, Twelve Data, etc.).
4. **Serverless function limit** — Nexxore is at 11/11 Vercel Hobby tier functions. No new API endpoints can be added without upgrading.
5. **Correlation matrix is static** — Shows approximate real-world correlations, not dynamically calculated from price data.
6. **Ship positions are midpoint markers** — Not real AIS vessel tracking data (which requires MarineTraffic API subscription).

### Future Enhancements

- [ ] **Live index data** via Yahoo Finance or Twelve Data API
- [ ] **WebSocket feeds** for real-time crypto price updates (Binance WS)
- [ ] **AIS vessel tracking** integration (MarineTraffic / VesselFinder API)
- [ ] **Dynamic correlation calculator** from historical price data
- [ ] **TradingView-style charts** embedded per asset
- [ ] **DeFi TVL** panel (DeFi Llama API)
- [ ] **Options chain** panel (from existing Nexxore API)
- [ ] **ACLED conflict data** for real-time geopolitical event tracking
- [ ] **NASA EONET** for natural disaster tracking
- [ ] **FRED API** for live macro indicators (M2, CPI, unemployment)
- [ ] **Backend cron** for caching slow APIs (commodities, indices, macro)
- [ ] **Alert system** with sound notifications on high-impact events

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Feb 2026 | Initial terminal — crypto prices, chart, orderbook, 3 RSS feeds, basic F&G |
| v2.0 | Mar 2026 | Bloomberg rewrite — 7 RSS feeds, Leaflet map, 6 conflicts, 4 weather events, commodities panel, boot sequence |
| **v3.0** | **Mar 12, 2026** | **Advanced geopolitical monitor — 8 shipping lanes, 8 chokepoints, 10 conflicts, sanctions tracker, energy hubs, 18 global indices (Nifty/Sensex), supply chain data (BDI, container rates), correlation matrix, price driver analysis, 9 RSS feeds, crypto impact badges, INDIA region** |

---

*Built by Nexxore — Crypto Risk Infrastructure for the Institutional Age.*
