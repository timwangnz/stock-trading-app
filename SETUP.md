# StockVibe — Setup Guide

A React app for learning Vibe coding through a stock trading simulator.

---

## Quick Start

**Step 1 — Add your Polygon.io API key**

Create a file called `.env` in the project root (same folder as `package.json`):

```
VITE_POLYGON_API_KEY=your_key_here
```

Find your key at: **polygon.io → Dashboard → API Keys**

**Step 2 — Install and run**

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

> The app fetches live market data from Polygon.io on every page load.
> Outside market hours you'll still see the latest available prices.

---

## Recommended VS Code Extensions

When you open this folder in VS Code, it will suggest these extensions (accept them):

- **ESLint** — catches JavaScript errors as you type
- **Prettier** — auto-formats your code on save
- **Tailwind CSS IntelliSense** — autocomplete for Tailwind class names
- **ES7+ React Snippets** — shortcuts like `rafce` to generate components

---

## Project Structure

```
src/
├── main.jsx              # Entry point — mounts the React app
├── App.jsx               # Root component — renders layout + current page
├── index.css             # Global styles + Tailwind imports
│
├── context/
│   └── AppContext.jsx    # Global state (portfolio, watchlist, navigation)
│
├── data/
│   └── mockData.js       # Simulated stock prices + price history generator
│
├── components/
│   ├── Layout/
│   │   ├── Sidebar.jsx   # Left navigation bar
│   │   └── Header.jsx    # Top bar with search
│   └── StockCard.jsx     # Reusable card component for a single stock
│
└── pages/
    ├── Dashboard.jsx     # Market overview — all stocks, top movers
    ├── Portfolio.jsx     # Your holdings + P&L table
    ├── Watchlist.jsx     # Stocks you're tracking
    └── StockDetail.jsx   # Single stock with interactive price chart
```

---

## Key Concepts to Explore

| Concept | Where to find it |
|---|---|
| `useState` hook | `Header.jsx`, `StockDetail.jsx`, `Portfolio.jsx` |
| `useReducer` + Context | `AppContext.jsx` |
| `useMemo` for derived data | `Dashboard.jsx`, `Portfolio.jsx`, `StockDetail.jsx` |
| Props & component composition | `StockCard.jsx` |
| Conditional rendering | `App.jsx` (page switching), `Watchlist.jsx` (empty state) |
| Recharts library | `StockDetail.jsx` |
| Tailwind CSS | Every component |

---

## Ideas for Extending the App

Once you're comfortable with the codebase, try these challenges:

1. **Add a candlestick chart** — use the `open/high/low/close` fields in `mockData.js`
2. **Real data** — swap `mockData.js` for calls to the free [Polygon.io](https://polygon.io) or [Alpha Vantage](https://www.alphavantage.co) APIs
3. **Paper trading** — add a "cash balance" to the portfolio and deduct it when buying shares
4. **Price alerts** — let users set a target price and show a notification when it's hit
5. **Persist state** — save portfolio & watchlist to `localStorage` so they survive page reloads

---

> **Disclaimer:** All data is simulated. This app is for learning purposes only — not financial advice.
