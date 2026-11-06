export interface GaugeDialProps {
  /** Current value, 0–1. */
  value: number;
  /** Threshold marker position, 0–1 (e.g. the risk_off threshold). */
  threshold?: number;
  /** Accessible label; also shown under the numeric readout. */
  label?: string;
  size?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Semicircular 0–1 gauge with an optional threshold marker. The arc + needle
 * use the regime `--accent` variable, so the gauge recolors with the site.
 */
export function GaugeDial({ value, threshold, label, size = 220 }: GaugeDialProps) {
  const v = clamp01(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const stroke = 12;

  // Map t in [0,1] to a point on the top semicircle (180deg sweep, left→right).
  const pointAt = (t: number) => {
    const angle = Math.PI * (1 - clamp01(t)); // 180deg → 0deg
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  };

  const start = pointAt(0);
  const end = pointAt(1);
  const valPoint = pointAt(v);
  const arc = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;

  return (
    <figure className="nx-gauge" style={{ width: size }}>
      <svg
        width={size}
        height={cy + 8}
        viewBox={`0 0 ${size} ${cy + 8}`}
        role="img"
        aria-label={`${label ?? 'Gauge'}: ${(v * 100).toFixed(0)} out of 100`}
      >
        {/* Track */}
        <path d={arc(start, end)} className="nx-gauge__track" fill="none" strokeWidth={stroke} />
        {/* Value arc */}
        <path
          d={arc(start, valPoint)}
          className="nx-gauge__value"
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Threshold marker */}
        {typeof threshold === 'number'
          ? (() => {
              const t = pointAt(threshold);
              const inner = {
                x: cx + (r - stroke) * Math.cos(Math.PI * (1 - clamp01(threshold))),
                y: cy - (r - stroke) * Math.sin(Math.PI * (1 - clamp01(threshold))),
              };
              return (
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={t.x}
                  y2={t.y}
                  className="nx-gauge__threshold"
                  strokeWidth={2}
                />
              );
            })()
          : null}
      </svg>
      <figcaption className="nx-gauge__caption">
        <span className="nx-gauge__readout">{v.toFixed(3)}</span>
        {label ? <span className="nx-gauge__label">{label}</span> : null}
      </figcaption>
    </figure>
  );
}
