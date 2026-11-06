/**
 * LiveBadge — the ONLY sanctioned status strings (PRD hygiene). The type makes
 * inventing a fuzzy "COMING SOON!!" badge a compile error, killing the
 * "LIVE in marketing / PENDING on the page" class of contradiction.
 */
export const LIVE_BADGE_STATUSES = ['LIVE', 'SIMULATED', 'IN AUDIT', 'PENDING'] as const;

export type LiveBadgeStatus = (typeof LIVE_BADGE_STATUSES)[number];

export interface LiveBadgeProps {
  status: LiveBadgeStatus;
}

const STATUS_CLASS: Record<LiveBadgeStatus, string> = {
  LIVE: 'nx-badge--live',
  SIMULATED: 'nx-badge--simulated',
  'IN AUDIT': 'nx-badge--audit',
  PENDING: 'nx-badge--pending',
};

export function LiveBadge({ status }: LiveBadgeProps) {
  return (
    <span className={`nx-badge ${STATUS_CLASS[status]}`} role="status">
      <span className="nx-badge__dot" aria-hidden="true" />
      {status}
    </span>
  );
}
