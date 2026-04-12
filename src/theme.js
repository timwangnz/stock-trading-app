/**
 * theme.js — Single source of truth for TradeBuddy's color tokens.
 *
 * HOW IT WORKS
 * ────────────
 * Actual color values live as CSS custom properties in index.css.
 * Switching from light → dark simply sets data-theme="dark" on <html>,
 * which swaps the variable values — Tailwind utility classes re-render
 * automatically with zero component changes.
 *
 * WHAT LIVES HERE
 * ───────────────
 * • `colors`      → passed to tailwind.config.js so bg-surface, text-primary, etc. work
 * • `THEMES`      → raw hex values consumed by ThemeContext for recharts inline props
 *                   (recharts can't use CSS variables, so it needs real hex at render time)
 *
 * TO RESTYLE
 * ──────────
 * Edit the CSS variables in src/index.css.
 * Change the matching hex values in THEMES below so charts stay in sync.
 */

// ── Tailwind color map (CSS variable references) ─────────────────────────────
// <alpha-value> is replaced by Tailwind when you use opacity modifiers
// e.g. bg-surface/50, text-primary/60, border-border/30 all work.
export const colors = {
  surface: {
    DEFAULT: 'rgb(var(--surface)       / <alpha-value>)',
    card:    'rgb(var(--surface-card)  / <alpha-value>)',
    hover:   'rgb(var(--surface-hover) / <alpha-value>)',
  },
  accent: {
    blue:   'rgb(var(--accent-blue)   / <alpha-value>)',
    purple: 'rgb(var(--accent-purple) / <alpha-value>)',
  },
  gain: 'rgb(var(--gain) / <alpha-value>)',
  loss: 'rgb(var(--loss) / <alpha-value>)',

  // Text tokens — use text-primary, text-secondary, text-muted, text-faint
  primary:   'rgb(var(--text-primary)   / <alpha-value>)',
  secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
  muted:     'rgb(var(--text-muted)     / <alpha-value>)',
  faint:     'rgb(var(--text-faint)     / <alpha-value>)',

  // Border token — use border-border
  border: 'rgb(var(--border) / <alpha-value>)',
}

// ── Per-theme hex values for recharts inline props ───────────────────────────
// Keep in sync with the CSS variables in index.css.
export const THEMES = {
  light: {
    chart: {
      grid:      '#e2e8f0',
      axis:      '#94a3b8',
      reference: '#cbd5e1',
      tooltip:   { bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
    },
    pieColors: ['#2563eb','#7c3aed','#16a34a','#f59e0b','#ec4899','#06b6d4','#f97316'],
  },
  dark: {
    chart: {
      grid:      'rgba(255,255,255,0.06)',
      axis:      'rgba(255,255,255,0.30)',
      reference: 'rgba(255,255,255,0.12)',
      tooltip:   { bg: '#272b3d', border: 'rgba(255,255,255,0.08)', text: '#ffffff' },
    },
    pieColors: ['#60a5fa','#a78bfa','#4ade80','#fb923c','#f472b6','#34d399','#facc15'],
  },
}
