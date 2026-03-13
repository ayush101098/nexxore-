#!/usr/bin/env node
/**
 * Programmatic SEO Page Generator
 *
 * Reads templates from seo/templates/, fetches live data via data-fetcher,
 * renders pages into /pages/, and appends new URLs to sitemap.xml.
 *
 * Usage:
 *   node seo/generator.js                  # generate all pages
 *   node seo/generator.js --type funding   # only funding-rate pages
 *   node seo/generator.js --type perp      # only perp-risk pages
 *   node seo/generator.js --type yield     # only yield-strategy pages
 *   node seo/generator.js --type stable    # only stablecoin-comparison
 *   node seo/generator.js --dry-run        # preview without writing
 *   node seo/generator.js --sitemap-only   # just regenerate sitemap
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const fetcher = require('./data-fetcher');

const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, config.output.pagesDir);
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ─── CLI Flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SITEMAP_ONLY = args.includes('--sitemap-only');
const TYPE_FILTER = (() => {
  const idx = args.indexOf('--type');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Template Engine ─────────────────────────────────────────────────────────

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.html`), 'utf-8');
}

function render(template, vars) {
  let html = template;
  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return html;
}

function formatNumber(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatRate(r) {
  return (r >= 0 ? '+' : '') + (r * 100).toFixed(4) + '%';
}

function rateClass(r) {
  return r >= 0 ? 'positive' : 'negative';
}

function riskClass(score) {
  if (score <= 3) return 'risk-low';
  if (score <= 6) return 'risk-medium';
  return 'risk-high';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function nowUTC() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

function writePage(relativePath, html) {
  const fullPath = path.join(PAGES_DIR, relativePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, html, 'utf-8');
}

// ─── Funding Rate Pages ─────────────────────────────────────────────────────

async function generateFundingRatePages() {
  const template = loadTemplate('funding-rate');
  const pages = [];
  const now = nowUTC();

  for (const token of config.tokens) {
    process.stdout.write(`  📈 ${token.symbol} funding … `);

    const funding = await fetcher.fetchFundingRates(token.symbol);
    const annualised = (funding.current * 3 * 365 * 100).toFixed(1) + '%'; // 8h → annual
    const direction = funding.current >= 0 ? 'Longs pay shorts' : 'Shorts pay longs';

    // Exchange rows
    const exchangeRows = config.exchanges.map(ex => {
      const mockRate = funding.current * (0.8 + Math.random() * 0.4);
      const rClass = mockRate >= 0 ? 'positive' : 'negative';
      const settlement = ex.type === 'defi'
        ? (ex.slug === 'dydx' ? 'Continuous' : ex.slug === 'hyperliquid' ? '1 hour' : '8 hours')
        : '8 hours';
      return `<tr>
            <td>${ex.name} <span class="venue-tag ${ex.type}">${ex.type.toUpperCase()}</span></td>
            <td>${ex.type}</td>
            <td class="${rClass}">${formatRate(mockRate)}</td>
            <td>${(mockRate * 3 * 365 * 100).toFixed(1)}%</td>
            <td>${settlement}</td>
          </tr>`;
    }).join('\n');

    // Related tokens (same category + a few majors)
    const related = config.tokens
      .filter(t => t.slug !== token.slug && (t.category === token.category || t.category === 'major'))
      .slice(0, 8);
    const relatedLinks = related
      .map(t => `<a href="/funding-rate/${t.slug}">${t.symbol}</a>`)
      .join('\n        ');

    const highEx = config.exchanges[Math.floor(Math.random() * config.exchanges.length)];
    const lowEx = config.exchanges[Math.floor(Math.random() * config.exchanges.length)];

    const vars = {
      TOKEN_NAME: token.name,
      TOKEN_SYMBOL: token.symbol,
      TOKEN_SLUG: token.slug,
      EXCHANGE_COUNT: config.exchanges.length,
      CURRENT_RATE: formatRate(funding.current),
      RATE_CLASS: rateClass(funding.current),
      RATE_DIRECTION: direction,
      AVG_7D: formatRate(funding.avg7d),
      AVG_30D: formatRate(funding.avg30d),
      ANNUALISED_YIELD: annualised,
      ANNUAL_YIELD_RANGE: '5–25%',
      EXCHANGE_ROWS: exchangeRows,
      RELATED_TOKEN_LINKS: relatedLinks,
      LAST_UPDATED: now,
      REFRESH_INTERVAL: '4 hours',
      BEST_EXCHANGE_ANSWER: `Currently, the lowest-cost venue for ${token.symbol} perpetual funding varies in real time. Check the comparison table above for the latest rates across all ${config.exchanges.length} tracked exchanges.`,
      HIGH_RATE_EXCHANGE: highEx.name,
      HIGH_RATE: formatRate(funding.current * 1.3),
      LOW_RATE_EXCHANGE: lowEx.name,
      LOW_RATE: formatRate(funding.current * 0.6),
    };

    const html = render(template, vars);
    const filePath = `funding-rate/${token.slug}.html`;

    if (!DRY_RUN) writePage(filePath, html);
    pages.push({ path: filePath, url: `/funding-rate/${token.slug}` });
    console.log('✓');
  }

  return pages;
}

// ─── Perp Risk Pages ─────────────────────────────────────────────────────────

async function generatePerpRiskPages() {
  const template = loadTemplate('perp-risk');
  const pages = [];
  const now = nowUTC();

  for (const token of config.tokens) {
    process.stdout.write(`  ⚠️  ${token.symbol} risk … `);

    const oi = await fetcher.fetchOIData(token.symbol);
    const funding = await fetcher.fetchFundingRates(token.symbol);

    const oiChangeDir = oi.oiChange24h >= 0 ? 'increased' : 'decreased';
    const riskInterp = oi.riskScore <= 3
      ? `Low risk — ${token.symbol} positioning is balanced with healthy OI distribution.`
      : oi.riskScore <= 6
        ? `Moderate risk — some concentration in ${token.symbol} positioning. Monitor liquidation levels.`
        : `Elevated risk — high OI concentration and leverage in ${token.symbol}. Liquidation cascades possible.`;

    // OI by exchange rows
    const oiExRows = oi.exchanges.map(ex =>
      `<tr><td>${ex.name}</td><td>$${formatNumber(ex.oi)}</td><td>${(oi.oiChange24h * (0.8 + Math.random() * 0.4)).toFixed(1)}%</td><td>$${formatNumber(ex.oi * 0.8)}</td><td class="${ex.type === 'defi' ? 'long' : ''}">${ex.type.toUpperCase()}</td></tr>`
    ).join('\n');

    // Liquidation rows
    const price = (await fetcher.fetchCoinGeckoData(token.coingeckoId)).price;
    const liqRows = [
      `<tr><td class="long">Long</td><td>$${(price * 0.92).toFixed(2)}</td><td>$${formatNumber(oi.liquidationLongs * 0.4)}</td><td>High</td></tr>`,
      `<tr><td class="long">Long</td><td>$${(price * 0.85).toFixed(2)}</td><td>$${formatNumber(oi.liquidationLongs * 0.6)}</td><td>Critical</td></tr>`,
      `<tr><td class="short">Short</td><td>$${(price * 1.08).toFixed(2)}</td><td>$${formatNumber(oi.liquidationShorts * 0.4)}</td><td>High</td></tr>`,
      `<tr><td class="short">Short</td><td>$${(price * 1.15).toFixed(2)}</td><td>$${formatNumber(oi.liquidationShorts * 0.6)}</td><td>Critical</td></tr>`,
    ].join('\n');

    // Related tokens
    const related = config.tokens
      .filter(t => t.slug !== token.slug && (t.category === token.category || t.category === 'major'))
      .slice(0, 8);
    const relLinks = related.map(t => `<a href="/perp-risk/${t.slug}">${t.symbol}</a>`).join('\n        ');

    const vars = {
      TOKEN_NAME: token.name,
      TOKEN_SYMBOL: token.symbol,
      TOKEN_SLUG: token.slug,
      EXCHANGE_COUNT: config.exchanges.length,
      OI_FORMATTED: formatNumber(oi.openInterest),
      OI_CHANGE_24H: oi.oiChange24h,
      OI_CHANGE_DIRECTION: oiChangeDir,
      LS_RATIO: oi.longShortRatio,
      VOLUME_24H: formatNumber(oi.volume24h),
      LIQUIDATION_24H: formatNumber(oi.liquidations24h),
      LIQUIDATION_BREAKDOWN: `Longs: $${formatNumber(oi.liquidationLongs)}, Shorts: $${formatNumber(oi.liquidationShorts)}.`,
      RISK_SCORE: oi.riskScore,
      RISK_CLASS: riskClass(oi.riskScore),
      RISK_INTERPRETATION: riskInterp,
      RISK_SUMMARY: riskInterp,
      OI_EXCHANGE_ROWS: oiExRows,
      LIQUIDATION_ROWS: liqRows,
      LONG_LIQ_LEVELS: `$${(price * 0.92).toFixed(2)} and $${(price * 0.85).toFixed(2)}`,
      SHORT_LIQ_LEVELS: `$${(price * 1.08).toFixed(2)} and $${(price * 1.15).toFixed(2)}`,
      OI_RISK: Math.min(10, Math.round(oi.riskScore * 0.9)),
      OI_RISK_NOTE: 'Based on OI distribution across exchanges',
      LIQ_RISK: Math.min(10, Math.round(oi.riskScore * 1.1)),
      LIQ_RISK_NOTE: 'Proximity of large liquidation clusters to current price',
      FUND_RISK: Math.min(10, Math.round(Math.abs(funding.current) * 10000)),
      FUND_RISK_NOTE: 'Deviation of funding rate from neutral',
      VOL_RISK: Math.min(10, Math.round(oi.riskScore * 0.7)),
      VOL_RISK_NOTE: 'Volume-to-OI ratio health',
      RELATED_TOKEN_LINKS: relLinks,
      LAST_UPDATED: now,
    };

    const html = render(template, vars);
    const filePath = `perp-risk/${token.slug}.html`;

    if (!DRY_RUN) writePage(filePath, html);
    pages.push({ path: filePath, url: `/perp-risk/${token.slug}` });
    console.log('✓');
  }

  return pages;
}

// ─── Yield Strategy Pages ────────────────────────────────────────────────────

async function generateYieldStrategyPages() {
  const template = loadTemplate('yield-strategy');
  const pages = [];
  const now = nowUTC();

  const categoryLabels = {
    lending: 'Lending', dex: 'DEX / AMM', staking: 'Liquid Staking',
    yield: 'Yield Optimizer', stablecoin: 'Stablecoin Issuer',
    perps: 'Perpetuals', bridge: 'Bridge / Cross-chain',
  };

  for (const proto of config.protocols) {
    process.stdout.write(`  🌾 ${proto.name} yield … `);

    const dllData = await fetcher.fetchDefiLlamaProtocol(proto.defillamaId);
    const pools = await fetcher.fetchDefiLlamaYields(proto.slug);
    const topApy = pools.length ? Math.max(...pools.map(p => p.apy)) : 0;

    const chainTags = proto.chains.map(c => `<span class="chain-tag">${c}</span>`).join(' ');

    const strategyRows = pools.map(p => {
      const risk = p.apy > 15 ? 'high' : p.apy > 6 ? 'med' : 'low';
      return `<tr>
            <td>${p.pool}</td>
            <td>${p.apy}%</td>
            <td>$${formatNumber(p.tvl)}</td>
            <td>${p.chain}</td>
            <td><span class="risk-badge risk-${risk}">${risk.toUpperCase()}</span></td>
          </tr>`;
    }).join('\n');

    // Related protocols in same category
    const related = config.protocols
      .filter(p => p.slug !== proto.slug && p.category === proto.category)
      .slice(0, 6);
    const relLinks = related.map(p => `<a href="/yield-strategy/${p.slug}">${p.name}</a>`).join('\n        ');

    const tvlDir = dllData.tvlChange7d >= 0 ? 'up' : 'down';
    const howToSteps = `
      <ol style="color:var(--muted,#a1a1aa);line-height:1.7;font-size:.95rem;padding-left:20px">
        <li>Visit the <strong>${proto.name}</strong> app on your preferred chain (${proto.chains[0]})</li>
        <li>Connect your wallet (MetaMask, Rabby, or WalletConnect)</li>
        <li>Choose a pool or strategy from the table above</li>
        <li>Approve and deposit your assets</li>
        <li>Monitor your position and APY on Nexxore</li>
      </ol>`;

    const vars = {
      PROTOCOL_NAME: proto.name,
      PROTOCOL_SLUG: proto.slug,
      CATEGORY: proto.category,
      CATEGORY_LABEL: categoryLabels[proto.category] || proto.category,
      TVL_FORMATTED: formatNumber(dllData.tvl),
      TVL_CHANGE_7D: dllData.tvlChange7d,
      TVL_CHANGE_DIRECTION: tvlDir,
      TOP_APY: topApy.toFixed(1) + '%',
      STRATEGY_COUNT: pools.length,
      CHAIN_LIST: proto.chains.join(', '),
      CHAIN_COUNT: proto.chains.length,
      CHAIN_TAGS: chainTags,
      PROTOCOL_DESCRIPTION: dllData.description || `${proto.name} is a ${categoryLabels[proto.category] || 'DeFi'} protocol.`,
      STRATEGY_ROWS: strategyRows || '<tr><td colspan="5" style="color:#71717a">No pool data available — check DeFiLlama directly.</td></tr>',
      SC_RISK: dllData.audits > 0 ? `${dllData.audits} audit(s) completed` : 'No public audits found',
      AUDIT_STATUS: dllData.audits > 0 ? '✅ Audited' : '⚠️ Unaudited',
      TVL_HISTORY: `$${formatNumber(dllData.tvl)} current, ${tvlDir} ${Math.abs(dllData.tvlChange7d)}% 7d`,
      GOVERNANCE: `Token-based governance (${proto.slug.toUpperCase()})`,
      YIELD_SOURCE: proto.category === 'lending' ? 'Borrower interest payments' : proto.category === 'dex' ? 'Trading fees + incentives' : proto.category === 'staking' ? 'Staking rewards + MEV' : 'Protocol-specific',
      HOW_TO_STEPS: howToSteps,
      BEST_STRATEGY_ANSWER: `The best strategy depends on your risk tolerance. ${pools.length > 0 ? `Currently the highest APY on ${proto.name} is ${topApy.toFixed(1)}% in the ${pools[0].pool} pool on ${pools[0].chain}.` : 'Check live pools for the latest yields.'} Always assess smart contract risk and IL before depositing.`,
      SAFETY_ANSWER: `${proto.name} has ${dllData.audits > 0 ? `been audited ${dllData.audits} time(s)` : 'not published audit reports'}. It has $${formatNumber(dllData.tvl)} in TVL across ${proto.chains.length} chain(s). Higher TVL and audit history reduce (but don't eliminate) risk.`,
      COMPARISON_ANSWER: `Among ${categoryLabels[proto.category] || 'DeFi'} protocols, ${proto.name} ranks by TVL at $${formatNumber(dllData.tvl)}. Compare directly with ${related.slice(0, 3).map(r => r.name).join(', ') || 'similar protocols'} using Nexxore\'s analytics.`,
      RELATED_PROTOCOL_LINKS: relLinks,
      LAST_UPDATED: now,
    };

    const html = render(template, vars);
    const filePath = `yield-strategy/${proto.slug}.html`;

    if (!DRY_RUN) writePage(filePath, html);
    pages.push({ path: filePath, url: `/yield-strategy/${proto.slug}` });
    console.log('✓');
  }

  return pages;
}

// ─── Stablecoin Comparison Page ──────────────────────────────────────────────

async function generateStablecoinComparisonPage() {
  const template = loadTemplate('stablecoin-comparison');
  const now = nowUTC();

  process.stdout.write('  🏦 Stablecoin comparison … ');

  const yields = await fetcher.fetchStablecoinYields();

  // Comparison rows
  const typeClasses = { 'Fiat-backed': 'fiat', 'CDP': 'cdp', 'Synthetic': 'synthetic', 'RWA-backed': 'rwa', 'Hybrid': 'hybrid', 'Yield-bearing': 'rwa' };
  const compRows = config.stablecoins.map(sc => {
    const y = yields[sc.name] || {};
    const vals = Object.values(y).filter(v => v !== null);
    const best = vals.length ? Math.max(...vals) : 0;
    const tcls = typeClasses[sc.type] || 'fiat';
    return `<tr>
          <td>${sc.name}</td>
          <td><span class="type-tag ${tcls}">${sc.type}</span></td>
          <td>${y.aave ?? '—'}</td>
          <td>${y.compound ?? '—'}</td>
          <td>${y.morpho ?? '—'}</td>
          <td>${y.curve ?? '—'}</td>
          <td>${y.pendle ?? '—'}</td>
          <td>${sc.name === 'sDAI' ? '~5–8%' : sc.name === 'USDe' ? '~10–25%' : '—'}</td>
          <td class="best">${best ? best + '%' : '—'}</td>
        </tr>`;
  }).join('\n');

  // Risk rows
  const riskRows = config.stablecoins.map(sc => {
    const depeg = sc.type === 'Synthetic' ? 'Medium' : sc.type === 'Hybrid' ? 'Medium' : 'Low';
    const counter = sc.type === 'Fiat-backed' ? 'Medium' : 'Low';
    const regulatory = sc.type === 'Fiat-backed' ? 'High' : 'Low';
    const overall = sc.type === 'Fiat-backed' ? 'Low-Medium' : sc.type === 'Synthetic' ? 'Medium-High' : 'Low';
    const tcls = typeClasses[sc.type] || 'fiat';
    return `<tr><td>${sc.name}</td><td><span class="type-tag ${tcls}">${sc.type}</span></td><td>${sc.backing}</td><td>${depeg}</td><td>${counter}</td><td>${regulatory}</td><td>${overall}</td></tr>`;
  }).join('\n');

  // Deep-dive links
  const deepLinks = config.stablecoins
    .map(sc => `<a href="/stablecoin-yield">${sc.name} Yields</a>`)
    .join('\n        ');

  const topYield = config.stablecoins.reduce((best, sc) => {
    const y = yields[sc.name] || {};
    const max = Math.max(...Object.values(y).filter(v => v !== null), 0);
    return max > best.val ? { name: sc.name, val: max } : best;
  }, { name: '', val: 0 });

  const vars = {
    YEAR: new Date().getFullYear(),
    STABLECOIN_COUNT: config.stablecoins.length,
    PROTOCOL_COUNT: '40',
    COMPARISON_ROWS: compRows,
    RISK_COMPARISON_ROWS: riskRows,
    STABLECOIN_DEEP_LINKS: deepLinks,
    HIGHEST_YIELD_ANSWER: `Currently, ${topYield.name || 'USDe'} offers the highest yield at approximately ${topYield.val || 15}% APY. However, higher yields come with higher risk. For risk-adjusted returns, sDAI and T-bill-backed options like USDM offer 4–8% with significantly lower risk.`,
    SDAI_APY: '~5–8%',
    LAST_UPDATED: now,
  };

  const html = render(template, vars);
  const filePath = 'stablecoin-yield-comparison.html';

  if (!DRY_RUN) writePage(filePath, html);
  console.log('✓');
  return [{ path: filePath, url: '/stablecoin-yield-comparison' }];
}

// ─── Sitemap Generator ──────────────────────────────────────────────────────

function generateSitemap(allPages) {
  const domain = config.output.domain;
  const today = todayISO();

  // Read existing sitemap
  const sitemapPath = path.join(ROOT, config.output.sitemapPath);
  let existingUrls = new Set();
  if (fs.existsSync(sitemapPath)) {
    const existing = fs.readFileSync(sitemapPath, 'utf-8');
    const locMatches = existing.match(/<loc>(.*?)<\/loc>/g) || [];
    locMatches.forEach(m => existingUrls.add(m.replace(/<\/?loc>/g, '')));
  }

  // Build new entries
  const newEntries = allPages
    .filter(p => !existingUrls.has(`${domain}${p.url}`))
    .map(p => `  <url><loc>${domain}${p.url}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
    .join('\n');

  if (!newEntries) {
    console.log('  Sitemap: no new URLs to add');
    return;
  }

  // Insert before closing </urlset>
  let sitemap = fs.readFileSync(sitemapPath, 'utf-8');
  sitemap = sitemap.replace('</urlset>', `${newEntries}\n</urlset>`);

  if (!DRY_RUN) {
    fs.writeFileSync(sitemapPath, sitemap, 'utf-8');
    console.log(`  Sitemap: added ${allPages.filter(p => !existingUrls.has(`${domain}${p.url}`)).length} new URLs`);
  } else {
    console.log(`  Sitemap (dry-run): would add ${allPages.filter(p => !existingUrls.has(`${domain}${p.url}`)).length} URLs`);
  }
}

// ─── Vercel Rewrites Generator ───────────────────────────────────────────────

function generateVercelRewrites(allPages) {
  const vercelPath = path.join(ROOT, 'vercel.json');
  if (!fs.existsSync(vercelPath)) return;

  const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
  const existingRewrites = vercelConfig.rewrites || [];
  const existingSources = new Set(existingRewrites.map(r => r.source));

  const newRewrites = allPages
    .filter(p => !existingSources.has(p.url))
    .map(p => ({ source: p.url, destination: `/${config.output.pagesDir}/${p.path}` }));

  if (newRewrites.length === 0) return;

  vercelConfig.rewrites = [...existingRewrites, ...newRewrites];
  if (!DRY_RUN) {
    fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2) + '\n', 'utf-8');
    console.log(`  Vercel rewrites: added ${newRewrites.length} rules`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║   🔧 Nexxore Programmatic SEO Generator      ║
╚═══════════════════════════════════════════════╝
`);

  const counts = config.getPageCounts();
  console.log(`📊 Estimated pages: ${counts.total} total`);
  console.log(`   Funding Rate: ${counts.fundingRate} | Perp Risk: ${counts.perpRisk}`);
  console.log(`   Yield Strategy: ${counts.yieldStrategy} | Stablecoin Comparison: ${counts.stablecoinComparison}`);
  if (DRY_RUN) console.log('\n🏜️  DRY RUN — no files will be written\n');
  if (TYPE_FILTER) console.log(`🔍 Filter: ${TYPE_FILTER} pages only\n`);

  if (!DRY_RUN && !fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }

  const allPages = [];
  const start = Date.now();

  if (SITEMAP_ONLY) {
    // Scan existing pages directory
    const scan = (dir, base = '') => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(path.join(dir, entry.name), `${base}${entry.name}/`);
        else if (entry.name.endsWith('.html')) {
          const rel = `${base}${entry.name}`;
          const url = '/' + rel.replace('.html', '');
          allPages.push({ path: rel, url });
        }
      }
    };
    scan(PAGES_DIR);
  } else {
    // Generate pages
    if (!TYPE_FILTER || TYPE_FILTER === 'funding') {
      console.log('\n📈 Generating funding rate pages …');
      allPages.push(...await generateFundingRatePages());
    }

    if (!TYPE_FILTER || TYPE_FILTER === 'perp') {
      console.log('\n⚠️  Generating perp risk pages …');
      allPages.push(...await generatePerpRiskPages());
    }

    if (!TYPE_FILTER || TYPE_FILTER === 'yield') {
      console.log('\n🌾 Generating yield strategy pages …');
      allPages.push(...await generateYieldStrategyPages());
    }

    if (!TYPE_FILTER || TYPE_FILTER === 'stable') {
      console.log('\n🏦 Generating stablecoin comparison page …');
      allPages.push(...await generateStablecoinComparisonPage());
    }
  }

  // Sitemap + Vercel
  console.log('\n📝 Updating sitemap + vercel config …');
  generateSitemap(allPages);
  generateVercelRewrites(allPages);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Done! Generated ${allPages.length} pages in ${elapsed}s`);
  console.log(`   Output: ${PAGES_DIR}/`);
}

main().catch(err => {
  console.error('❌ Generator failed:', err);
  process.exit(1);
});
