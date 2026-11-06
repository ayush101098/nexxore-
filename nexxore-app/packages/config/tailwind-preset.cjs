/**
 * Shared Tailwind preset — the single source of the NEXXORE design tokens
 * (PRD §A.3, Palette v2). Every app/package references these token classes;
 * raw hex literals are forbidden in apps/web and enforced by a CI gate
 * (apps/web/scripts/check-tokens.mjs).
 *
 * Two color roles, kept strictly separate:
 *   • Regime accents (emerald / amber / red) are purely INFORMATIONAL — driven
 *     by `data-regime` on <html>. Never used for "is this clickable?".
 *   • The brand accent (electric cyan) is the ONLY interactive color — links,
 *     buttons, focus rings — so users never confuse "red = danger" with a
 *     clickable control.
 */
/** @type {import("tailwindcss").Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Terminal base palette — near-black background + 3 elevation steps.
        base: {
          DEFAULT: '#07080B',
          900: '#07080B',
          800: '#0C0E12', // surface 1
          700: '#12151B', // surface 2
          600: '#191D25', // surface 3 (interactive cards)
        },
        // Hairline borders at 8% / 14% white.
        line: {
          DEFAULT: 'rgba(255,255,255,0.08)',
          strong: 'rgba(255,255,255,0.14)',
        },
        // Text hierarchy at 92% / 64% / 40% white.
        fg: {
          DEFAULT: 'rgba(255,255,255,0.92)',
          primary: 'rgba(255,255,255,0.92)',
          secondary: 'rgba(255,255,255,0.64)',
          muted: 'rgba(255,255,255,0.40)',
        },
        // Regime accent — resolved from CSS variables set by data-regime.
        accent: {
          DEFAULT: 'var(--accent)',
          muted: 'var(--accent-muted)',
          glow: 'var(--accent-glow)',
          contrast: 'var(--accent-contrast)',
        },
        // Brand accent (electric cyan) — interactive elements ONLY.
        brand: {
          DEFAULT: '#22D3EE',
          hover: '#67E8F9',
          muted: 'rgba(34,211,238,0.16)',
          contrast: '#04141A',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'accent-glow': '0 0 32px var(--accent-glow)',
      },
      transitionTimingFunction: {
        instrument: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        micro: '150ms',
        standard: '300ms',
        loop: '700ms',
      },
    },
  },
  plugins: [],
};
