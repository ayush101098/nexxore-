export { Nav } from './components/Nav';
export { Footer } from './components/Footer';
export { SiteShell } from './components/SiteShell';
export { RegimeChip, type RegimeChipProps } from './components/RegimeChip';
export { StatCard, type StatCardProps } from './components/StatCard';
export {
  LiveBadge,
  LIVE_BADGE_STATUSES,
  type LiveBadgeProps,
  type LiveBadgeStatus,
} from './components/LiveBadge';
export { EvidenceLink, type EvidenceLinkProps } from './components/EvidenceLink';
export { SectionHeader, type SectionHeaderProps } from './components/SectionHeader';
export { GaugeDial, type GaugeDialProps } from './components/GaugeDial';
export { DataTable, type DataTableColumn, type DataTableProps } from './components/DataTable';
export {
  RegimeProvider,
  useRegime,
  type RegimeProviderProps,
} from './regime-context';
export {
  REGIME_META,
  PLACEHOLDER_REGIME,
  type Regime,
  type RegimeMeta,
} from './regime';
export {
  PRODUCT_LINKS,
  FOOTER_LINKS,
  SOCIAL_LINKS,
  type NavLink,
} from './nav-links';
export { buildMeta, type BuildMetaOptions } from './meta';
export {
  Hero,
  ProblemSection,
  LoopSection,
  ProductsGrid,
  SequencingStrip,
  type HeroProps,
  type ProblemCard,
  type LoopStageView,
  type LoopSectionProps,
  type ProductCardView,
  type ProductsGridProps,
} from './sections/home';
export { LoopAnimator } from './sections/LoopAnimator';
export {
  ProductShell,
  type ProductShellProps,
  type ProductShellLoopStage,
  type ProductStat,
  type LoopStageId,
} from './sections/ProductShell';
