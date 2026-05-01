# Daily Portfolio Snapshots — Integration Design

A design doc for adding daily portfolio snapshots to the `stock-trading-app`.
This is a **plan**, not code. You'll write the code yourself (that's the
vibe-coding practice); this doc tells you what to build, where it goes,
and why.

---

## 1. What we're building

A feature that records one "frozen" copy of the user's portfolio per
trading day and exposes that history to the UI so we can show:

- A line chart of total portfolio value over time.
- Day-over-day P/L (today vs. last snapshot).
- A "time machine" view — click any past day to see the positions as
  they were that day.

The existing app only ever knows **today's** value. Snapshots are what
let it remember yesterday.

---

## 2. Data model

A single snapshot record:

```
{
  id:            string,        // e.g. "2026-04-18"  (date = natural key)
  date:          string,        // ISO date, "YYYY-MM-DD"
  createdAt:     number,        // epoch ms, for debugging/ordering
  cash:          number,        // future-proofing; currently 0 in this app
  holdingsValue: number,        // Σ position.marketValue
  totalValue:    number,        // holdingsValue + cash
  positions: [
    {
      symbol:      string,
      shares:      number,
      avgCost:     number,      // cost basis at time of snapshot
      closePrice:  number,      // the price we froze in
      marketValue: number,      // shares * closePrice
      unrealized:  number       // (closePrice - avgCost) * shares
    }
  ]
}
```

Design notes:

- **`date` is the natural primary key.** Only one snapshot per day. A
  second write on the same day **overwrites** the existing record
  (last-write-wins). This keeps the math simple and avoids duplicate
  rows polluting the chart.
- We **copy `avgCost` into the snapshot** instead of recomputing it
  later. Cost basis changes after every buy, and old snapshots should
  reflect the cost basis *as it was* that day, not today's.
- We store `closePrice` at the position level so we can re-render an
  old snapshot without hitting the market data API again.

---

## 3. Storage: pick one

### Option A — `localStorage` (recommended for learning)

- Key: `portfolio_snapshots_v1`
- Value: JSON-stringified array of snapshot objects.
- Pros: zero backend work, survives page reloads, fast to iterate.
- Cons: per-device, cleared if the user clears site data, 5 MB cap
  (plenty — one snapshot is ~1 KB).

### Option B — The existing Express `server/`

- Add a `snapshots` table / JSON file on disk.
- Endpoints: `GET /api/snapshots`, `POST /api/snapshots`.
- Pros: cross-device, more realistic.
- Cons: more wiring, more things to debug while learning.

**Recommendation:** start with Option A. The service-layer abstraction
below means you can swap to Option B later by changing one file.

---

## 4. When do we write a snapshot?

Three triggers, in priority order:

1. **App load, if a day has passed.** On mount, compare `today's date`
   to the `date` of the most recent snapshot. If different, write one.
   This is the "I opened the app and it's a new day" case.
2. **After any trade that changes the portfolio.** Hook into the same
   places that dispatch `ADD_TO_PORTFOLIO`, `SELL_SHARES`, or
   `REMOVE_FROM_PORTFOLIO`. This keeps intra-day snapshots fresh for
   users who trade on the same day.
3. **Manual "Save snapshot now" button** on the Portfolio page. Useful
   for testing and for users who want to pin a specific moment.

All three paths call the same `writeSnapshot()` function, which
upserts by date — so triggering it three times on the same day is
cheap and safe.

### A note on weekends/holidays

Don't write a snapshot if the market was closed that day. Simplest
heuristic: skip Saturday (day 6) and Sunday (day 0). Real holiday
calendar is out of scope for v1.

---

## 5. File layout

All new files — no edits to existing files required for v1.

```
src/
  services/
    snapshotService.js      ← NEW. pure data layer (read/write/upsert)
  hooks/
    useSnapshots.js         ← NEW. React-facing hook, auto-writes on day change
  components/
    Portfolio/
      SnapshotHistoryCard.jsx   ← NEW. line chart + "time machine" UI
      SnapshotReplayTable.jsx   ← NEW. positions table for the selected date
  pages/
    Snapshots.jsx           ← NEW (optional). full-page view, linkable from nav
```

### 5a. `snapshotService.js` — the data layer

Pure functions, no React, no hooks. Easy to unit-test.

Exports:

- `getAllSnapshots()` → `Snapshot[]` (sorted ascending by date)
- `getSnapshotByDate(date)` → `Snapshot | null`
- `getLatestSnapshot()` → `Snapshot | null`
- `writeSnapshot(snapshot)` → upserts, returns the stored record
- `clearSnapshots()` → dev/debug only

Internally: one `load()` and one `save()` helper that talk to
`localStorage`. Swap those two for `fetch()` calls later and
everything above stays the same.

### 5b. `useSnapshots.js` — the React hook

Responsibilities:

- Expose `{ snapshots, latest, writeSnapshot }` to components.
- On mount, check if today has a snapshot; if not (and market is
  open today), build one from current `portfolio` + live `prices`
  and write it.
- Re-render consumers when snapshots change (local state inside
  the hook, plus a `storage` event listener if you want multi-tab
  sync — nice-to-have, not required).

Inputs: the hook needs access to `state.portfolio` and the current
`prices` Map. Easiest path: call `useApp()` and `useLivePrices()`
inside the hook. Tradeoff: the hook now depends on both contexts,
which is fine for this app.

### 5c. `SnapshotHistoryCard.jsx`

A card that renders:

- A Recharts `LineChart` of `snapshot.totalValue` over `snapshot.date`.
- A "selected day" pill above the chart; clicking a point changes it.
- A tiny KPI row: selected-day value, delta vs. prior snapshot, %.

Think of it as a drop-in sibling to your existing `StockTreemap` in
`Portfolio.jsx` — same card styling (`bg-surface-card`, `rounded-xl`,
etc.) to match the design system.

### 5d. `SnapshotReplayTable.jsx`

Given a single snapshot, render its `positions` array as a table
with columns: Symbol, Shares, Close Price, Market Value, Unrealized.
This is the "time machine" view.

---

## 6. Integration points

Even though we won't edit existing files in this doc, here's **where**
you'd wire it in when the time comes:

- **`pages/Portfolio.jsx`** — below the `StockTreemap`, before the
  Holdings table, drop in `<SnapshotHistoryCard />`. It reads from
  `useSnapshots()` on its own, so no prop plumbing needed.
- **`components/Layout/`** (sidebar/nav) — add a "Snapshots" link
  pointing at a new `Snapshots` page if you want a dedicated view.
- **`pages/History.jsx`** — you already have a History page; consider
  whether snapshots belong there instead of (or in addition to) the
  Portfolio page. Worth a look before you build.

No changes required to `AppContext`, `useLivePrices`, or any reducer
actions. The snapshot system is a **read-only consumer** of existing
state.

---

## 7. Build order (suggested)

Do it in this order so every step is testable on its own:

1. `snapshotService.js` with `localStorage` backing. Test in the
   browser console: write a fake snapshot, read it back, overwrite
   same-day, read again.
2. `useSnapshots.js` — just the read path first. Confirm the hook
   returns what the service stored.
3. Wire the auto-write path in the hook. Open the app, confirm a
   snapshot for today appears. Change your system clock (or fake
   `new Date()`) and confirm a second snapshot appears.
4. `SnapshotHistoryCard.jsx`. Feed it mock data first, then real
   data from the hook.
5. `SnapshotReplayTable.jsx`, hooked up to the card's "selected day"
   state.
6. Drop the card into `Portfolio.jsx`.
7. Polish: loading state, empty state ("No snapshots yet — check
   back tomorrow"), and a "Save now" button for impatient users.

---

## 8. Edge cases & gotchas

- **First-ever load** — no snapshots exist. UI should show an empty
  state, not crash. The auto-write will fix this after ~1 second.
- **Portfolio is empty** — snapshot with `totalValue: 0` and empty
  `positions` array. Write it anyway; gaps in the chart are worse
  than a flatline.
- **Live prices haven't loaded yet** — don't write a snapshot with
  `price: 0`. Gate the auto-write on `!loading && prices.size > 0`.
- **Clock skew** — use `new Date().toISOString().slice(0, 10)`
  everywhere to get `YYYY-MM-DD`; avoid comparing `Date` objects
  directly.
- **Big portfolios** — one snapshot with 50 positions is ~5 KB.
  A year of snapshots is ~1.3 MB. Fine for `localStorage`, but
  consider a "retain last 365 days" trim policy in v2.

---

## 9. Testing plan

Unit (service layer):

- `writeSnapshot` upserts by date.
- `getAllSnapshots` returns sorted-ascending.
- Corrupt localStorage JSON → service returns `[]`, doesn't throw.

Integration (hook + UI):

- Open app → snapshot for today appears in `localStorage`.
- Execute a buy → snapshot for today is overwritten with new totals.
- Open on Saturday → no new snapshot written.
- Clear localStorage, reload → empty state renders; then one
  snapshot appears.

Manual:

- Use DevTools → Application → Local Storage to eyeball the JSON.
- Use the browser console to seed fake historical snapshots so you
  can see the chart render with real history.

---

## 10. What's explicitly out of scope for v1

- Multi-currency / FX conversion.
- Corporate action handling (splits, dividends adjusting old snapshots).
- Cost-basis methods (FIFO/LIFO/specific-lot). We store whatever
  `avgCost` the reducer produces.
- Server-side persistence (covered in §3 as a follow-up).
- Per-account / multi-portfolio views.
- Performance analytics (time-weighted return, Sharpe, etc.) — those
  are the *reason* snapshots exist, but they're their own feature.

---

## Appendix: reference implementation

The standalone `PortfolioSnapshotDemo.jsx` in this folder implements
§2 (data model) and the read-side of §5c (history chart) in one
self-contained file. Use it as a sanity-check for the shape of the
data and the look of the chart before you build the real thing.
