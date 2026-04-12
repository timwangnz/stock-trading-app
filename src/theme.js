/**
 * theme.js — Single source of truth for TradeBuddy's look & feel.
 *
 * USAGE
 * ─────
 * • tailwind.config.js  imports `colors` to wire up Tailwind utility classes
 *   (bg-surface, text-gain, border-accent-blue, etc.)
 *
 * • Components that need raw hex values (recharts, inline styles) can import
 *   `chart` or `pieColors` directly:
 *
 *     import { chart, pieColors } from '../theme'
 *
 * Changing a color here automatically propagates everywhere in the app.
 */

// ── Surface palette ──────────────────────────────────────────────────────────
// Controls page background, card/panel backgrounds, and hover states.
const surface = {
  DEFAULT: '#f8fafc',   // near-white page canvas
  card:    '#ffffff',   // card & panel background
  hover:   '#f1f5f9',   // subtle hover / input fill
}

// ── Accent colors ────────────────────────────────────────────────────────────
const accent = {
  blue:   '#2563eb',    // primary CTA — blue-600
  purple: '#7c3aed',    // secondary highlight — violet-600
}

// ── Semantic gain / loss ─────────────────────────────────────────────────────
const gain = '#16a34a'  // green-700
const loss = '#dc2626'  // red-600

// ── Text shades ──────────────────────────────────────────────────────────────
// These aren't wired into Tailwind (use slate-XXX utilities instead), but are
// exported so recharts and inline styles can stay in sync.
export const text = {
  primary:   '#0f172a',   // slate-900
  secondary: '#475569',   // slate-600
  muted:     '#94a3b8',   // slate-400
  faint:     '#cbd5e1',   // slate-300
}

// ── Border shades ────────────────────────────────────────────────────────────
export const border = {
  DEFAULT: '#e2e8f0',   // slate-200
  strong:  '#cbd5e1',   // slate-300
}

// ── Chart tokens (for recharts inline props) ─────────────────────────────────
export const chart = {
  grid:      '#e2e8f0',   // CartesianGrid stroke
  axis:      '#94a3b8',   // XAxis / YAxis tick fill
  reference: '#cbd5e1',   // ReferenceLine stroke
  tooltip: {
    bg:     '#ffffff',
    border: '#e2e8f0',
    text:   '#0f172a',
  },
}

// ── Pie / donut chart color palette ─────────────────────────────────────────
export const pieColors = [
  '#2563eb',  // blue-600
  '#7c3aed',  // violet-600
  '#16a34a',  // green-700
  '#f59e0b',  // amber-400
  '#ec4899',  // pink-500
  '#06b6d4',  // cyan-500
  '#f97316',  // orange-500
  '#8b5cf6',  // violet-500
]

// ── Tailwind color map (consumed by tailwind.config.js) ─────────────────────
// Keep all token names in sync with the Tailwind class names used in the app.
export const colors = {
  surface,
  accent,
  gain,
  loss,
}
