import type { Metadata } from 'next';
import {
  buildMeta,
  Hero,
  ProblemSection,
  LoopSection,
  ProductsGrid,
  SequencingStrip,
  type LoopStageView,
  type ProductCardView,
} from '@nexxore/ui';
import { HERO, PROBLEMS, LOOP, PRODUCTS_SECTION, SEQUENCING } from '@/content/home';
import { PRODUCTS } from '@/content/products';
import { ILLUSTRATIVE_INDEX, ILLUSTRATIVE_INDEX_THRESHOLD } from '@/content/stats';
import { ILLUSTRATIVE_CAPTION } from '@/content/copy';
import { loadStats, strap } from '@/lib/stats';

export const metadata: Metadata = buildMeta({
  title: 'home',
  titleOverride: 'NEXXORE — Regime-Aware Capital Allocation',
  description:
    'NEXXORE reads geopolitical, macro, and prediction-market signals and rotates on-chain capital defensively, automatically.',
  path: '/',
});

// Stats refresh from /v1/stats every 30s (ISR).
export const revalidate = 30;

export default async function HomePage() {
  const stats = await loadStats();

  const loopStages: LoopStageView[] = LOOP.stages.map((s) => ({
    id: s.id,
    name: s.name,
    route: s.route,
    metric: strap(stats, s.statKeys),
    points: s.points,
  }));

  const productCards: ProductCardView[] = PRODUCTS.map((p) => ({
    name: p.name,
    valueProp: p.valueProp,
    href: p.route,
    status: p.status,
    microStat: p.stats[0] ? strap(stats, [p.stats[0]]) : undefined,
  }));

  return (
    <>
      <Hero
        h1={HERO.h1}
        sub={HERO.sub}
        primaryCta={HERO.primaryCta}
        gauge={{
          value: ILLUSTRATIVE_INDEX,
          threshold: ILLUSTRATIVE_INDEX_THRESHOLD,
          label: HERO.gaugeLabel,
          caption: ILLUSTRATIVE_CAPTION,
        }}
      />
      <ProblemSection items={PROBLEMS} />
      <LoopSection kicker={LOOP.kicker} title={LOOP.title} stages={loopStages} />
      <ProductsGrid
        kicker={PRODUCTS_SECTION.kicker}
        title={PRODUCTS_SECTION.title}
        products={productCards}
      />
      <SequencingStrip headline={SEQUENCING.headline} body={SEQUENCING.body} />
    </>
  );
}
