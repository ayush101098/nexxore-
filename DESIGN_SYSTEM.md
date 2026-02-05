# Nexxore Design System v3.0

## Overview

This document defines the unified design token system for Nexxore. All visual properties flow from a single source of truth: `css/variables.css`.

---

## 🎨 Color System

### Background Hierarchy (4 levels)
```css
--bg-base: #09090b       /* App background */
--bg-elevated: #111113   /* Cards, panels, sidebars */
--bg-card: #161618       /* Interactive cards */
--bg-overlay: #1c1c1f    /* Modals, dropdowns, tooltips */
```

### Text Hierarchy (4 levels)
```css
--text-primary: #fafafa           /* Headlines, primary content */
--text-secondary: rgba(255,255,255,0.65)  /* Body text, descriptions */
--text-muted: rgba(255,255,255,0.4)       /* Labels, placeholders */
--text-disabled: rgba(255,255,255,0.25)   /* Disabled states */
```

### Border Hierarchy (4 levels)
```css
--border-subtle: rgba(255,255,255,0.06)   /* Default borders */
--border-default: rgba(255,255,255,0.10)  /* Slightly visible */
--border-hover: rgba(255,255,255,0.15)    /* Hover states */
--border-active: rgba(255,255,255,0.20)   /* Active/focus states */
```

### Brand Accents
```css
--accent-primary: #a855f7      /* Purple - brand, CTAs */
--accent-secondary: #22c55e    /* Green - success, growth */
```

### Semantic Colors (meaning-based)
```css
/* Success */
--semantic-success: #22c55e
--semantic-success-dim: rgba(34, 197, 94, 0.12)
--semantic-success-border: rgba(34, 197, 94, 0.25)

/* Warning */
--semantic-warning: #f59e0b
--semantic-warning-dim: rgba(245, 158, 11, 0.12)
--semantic-warning-border: rgba(245, 158, 11, 0.25)

/* Error */
--semantic-error: #ef4444
--semantic-error-dim: rgba(239, 68, 68, 0.12)
--semantic-error-border: rgba(239, 68, 68, 0.25)

/* Info */
--semantic-info: #3b82f6
--semantic-info-dim: rgba(59, 130, 246, 0.12)
--semantic-info-border: rgba(59, 130, 246, 0.25)
```

### Trading Colors
```css
--long: #22c55e    /* Green - long positions */
--short: #ef4444   /* Red - short positions */
```

### Risk Level Colors
```css
--accent-safe: #22c55e        /* Green - conservative */
--accent-balanced: #3b82f6    /* Blue - balanced */
--accent-aggressive: #a855f7  /* Purple - aggressive */
--accent-degen: #ef4444       /* Red - degen */
```

---

## 📐 Typography

### Font Families
```css
--font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif
--font-family-mono: 'JetBrains Mono', 'Fira Code', monospace
```

### Font Sizes
```css
--font-display: 32px   /* Hero headlines */
--font-title: 20px     /* Section titles */
--font-body: 14px      /* Body text */
--font-caption: 12px   /* Labels, captions */
--font-micro: 10px     /* Badges, tiny labels */
```

### Font Weights
```css
--weight-normal: 400
--weight-medium: 500
--weight-semibold: 600
--weight-bold: 700
```

---

## 📏 Spacing (4px base unit)

```css
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
--space-20: 80px
```

---

## 🔘 Border Radius

```css
--radius-sm: 4px       /* Inputs, small elements */
--radius-md: 8px       /* Buttons, cards */
--radius-lg: 12px      /* Large cards, panels */
--radius-xl: 16px      /* Modal containers */
--radius-full: 9999px  /* Pills, avatars */
```

---

## 🌫️ Shadows

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3)
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4)
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5)
--shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.6)
```

---

## ⚡ Transitions

```css
--transition-fast: 150ms ease          /* Micro-interactions */
--transition-base: 250ms ease-out      /* Standard animations */
--transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1)  /* Page transitions */
```

---

## 📱 Responsive Breakpoints

```css
/* Standard breakpoints */
480px   /* Mobile small */
640px   /* Mobile large */
768px   /* Tablet */
1024px  /* Desktop small */
1280px  /* Desktop large */
```

---

## 🔢 Z-Index Scale

```css
--z-dropdown: 100
--z-sticky: 200
--z-overlay: 300
--z-modal: 400
--z-toast: 500
```

---

## 📁 File Structure

```
css/
├── variables.css    ← Single source of truth
├── components.css   ← Component styles
├── base.css         ← Reset & defaults
└── layout.css       ← Grid & layout

frontend/css/
├── variables.css    ← Synced copy
└── ...
```

---

## 🔄 Migration Notes

### Legacy Token Aliases
The system includes backward-compatible aliases for legacy tokens:

| Legacy Token | New Token |
|-------------|-----------|
| `--bg` | `--bg-base` |
| `--text` | `--text-primary` |
| `--border` | `--border-subtle` |
| `--accent` | `--accent-primary` |
| `--success` | `--semantic-success` |
| `--error` | `--semantic-error` |

---

## ✅ Updated Pages (Phase 1)

- [x] css/variables.css (unified)
- [x] frontend/css/variables.css (synced)
- [x] index.html
- [x] research-agent.html
- [x] perps.html
- [x] vaults.html
- [x] safe-yield.html
- [x] analytics.html
- [x] strategy-builder.html
- [x] delta-neutral.html
- [x] dashboard.html
- [x] agents.html
- [x] signals-dashboard.html

---

## 🚀 Phase 2: Component Harmonization ✅

All major components now follow unified patterns from `css/components.css`:

### Buttons
```css
.btn              /* Base */
.btn-primary      /* Purple brand CTA */
.btn-secondary    /* Ghost/outline */
.btn-success      /* Green confirmations */
.btn-danger       /* Red destructive */
.btn-ghost        /* Minimal */
.btn-sm / .btn-lg /* Sizes */
.btn-full         /* Full width */
.btn-icon         /* Icon only */
```

### Cards
```css
.card             /* Base card */
.card-interactive /* Hoverable */
.card-elevated    /* With shadow */
.card-accent      /* Purple left border */
.card-success     /* Green left border */
.card-warning     /* Amber left border */
.card-error       /* Red left border */
```

### Form Inputs
```css
.form-group       /* Label + input wrapper */
.form-label       /* Uppercase label */
.form-input       /* Text input */
.form-input-sm    /* Small variant */
.form-input-lg    /* Large variant */
.form-row         /* Inline inputs */
```

### Navigation Tabs
```css
.tabs             /* Underline tabs container */
.tab              /* Single tab */
.tab.active       /* Active state */
.tabs-pills       /* Pill-style tabs */
```

### Stats / Metrics
```css
.stat             /* Single stat */
.stat-label       /* Micro uppercase */
.stat-value       /* Mono bold number */
.stat-value.positive / .negative
.stat-change      /* Change indicator */
.stats-row        /* Horizontal stats */
.stat-card        /* Card with icon */
```

### Badges
```css
.badge            /* Base */
.badge-primary    /* Purple */
.badge-success    /* Green */
.badge-warning    /* Amber */
.badge-error      /* Red */
.badge-info       /* Blue */
```

### Agent Cards
```css
.agents-grid      /* Auto-fit grid */
.agent-card       /* Hoverable card */
.agent-icon       /* Icon with accent bg */
.agent-title      /* Semibold name */
.agent-sub        /* Muted description */
```

### Modal
```css
.modal            /* Fixed overlay container */
.modal.active     /* Visible state */
.modal-overlay    /* Blur backdrop */
.modal-content    /* Centered panel */
.modal-close      /* X button */
.modal-title      /* Heading */
.modal-body       /* Content */
.modal-footer     /* Actions */
```

---

## ✨ Phase 3: Polish (Complete)

### Motion System (animations.css)

#### Timing Tokens
```css
--duration-instant: 100ms   /* Immediate feedback */
--duration-fast: 150ms      /* Hover states, small UI */
--duration-base: 250ms      /* Standard transitions */
--duration-slow: 350ms      /* Page transitions */
--duration-slower: 500ms    /* Complex animations */
```

#### Easing Functions
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)      /* Smooth deceleration */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)   /* Balanced */
--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1) /* Playful overshoot */
--ease-spring: cubic-bezier(0.43, 0.195, 0.02, 1) /* Natural spring */
```

#### Animation Classes
```css
.animate-fadeIn        /* Simple opacity */
.animate-fadeInUp      /* Fade + rise */
.animate-scaleIn       /* Scale entrance */
.animate-slideInLeft   /* Slide from left */
.animate-slideInRight  /* Slide from right */
.animate-slideInBottom /* Slide from bottom (modals) */
.animate-pulse         /* Subtle pulse (live indicators) */
.animate-spin          /* Rotation (spinners) */
.animate-shake         /* Error feedback */
.animate-bounce        /* Success feedback */
```

#### Stagger Delays
```css
.stagger-1 through .stagger-8  /* 50ms increments */
```

#### Hover Effects
```css
.hover-lift    /* Rise + shadow on hover */
.hover-scale   /* Subtle scale on hover */
.hover-glow    /* Purple glow on hover */
```

### Loading States

#### Skeleton Loading
```html
<div class="skeleton skeleton-title"></div>
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-avatar"></div>
<div class="skeleton skeleton-card"></div>
<div class="skeleton skeleton-stat"></div>
```

#### Spinners
```html
<div class="loading-spinner"></div>
<div class="loading-spinner loading-spinner-sm"></div>
<div class="loading-spinner loading-spinner-lg"></div>
```

#### Loading Dots
```html
<div class="loading-dots">
  <span></span><span></span><span></span>
</div>
```

#### Progress Bar
```html
<div class="progress-bar">
  <div class="progress-bar-fill" style="width: 60%"></div>
</div>

<!-- Indeterminate -->
<div class="progress-bar progress-bar-indeterminate">
  <div class="progress-bar-fill"></div>
</div>
```

### Focus States (Accessibility)

All interactive elements now have consistent `:focus-visible` states:
- 2px purple outline
- 2px offset
- Respects user preferences for reduced motion

```css
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

### Scroll Reveal

For intersection observer animations:
```css
.reveal           /* Fade up reveal */
.reveal-left      /* Slide from left */
.reveal-scale     /* Scale reveal */
```

Add `.visible` class via JavaScript when element enters viewport.

### Glass Effects
```css
.glass        /* Light blur (12px) */
.glass-heavy  /* Heavy blur (24px) */
```

### Reduced Motion

All animations respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  /* Animations disabled, transitions instant */
}
```

---

## 📁 File Structure

```
css/
├── variables.css    # Design tokens (source of truth)
├── base.css         # Reset, global styles, focus states
├── components.css   # Component library
├── animations.css   # Motion system
├── layout.css       # Page layouts
└── style.css        # Page-specific styles
```

---

## ✅ Design Audit Complete

### Phase 1: Token Unification ✓
- Single source of truth in variables.css
- 4-level background hierarchy
- 4-level text hierarchy
- Semantic color system
- 4px spacing scale

### Phase 2: Component Harmonization ✓
- Unified button system
- Consistent card styles
- Standardized forms
- Tab patterns
- Modal system
- Badge/status indicators

### Phase 3: Polish ✓
- Consistent animation timing
- Skeleton loading patterns
- Spinner variants
- Focus state accessibility
- Scroll reveal utilities
- Reduced motion support
- Glassmorphism effects
