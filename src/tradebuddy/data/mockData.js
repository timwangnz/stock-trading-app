// ─────────────────────────────────────────────────────────────
// Mock Stock Data
// In a real app you'd fetch this from an API like Polygon.io,
// Alpha Vantage, or Yahoo Finance. For learning, we generate
// realistic-looking data here so the app works offline.
// ─────────────────────────────────────────────────────────────

/**
 * Generate a series of daily closing prices using a random walk.
 * @param {number} startPrice - Starting price
 * @param {number} days - Number of days of history
 * @param {number} volatility - How much the price can move each day (0.01 = 1%)
 */
export function generatePriceHistory(startPrice, days = 90, volatility = 0.02) {
  const history = []
  let price = startPrice

  // Work backwards from today
  const today = new Date()
  for (let i = days; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)

    // Skip weekends (markets are closed)
    if (date.getDay() === 0 || date.getDay() === 6) continue

    // Random daily change using a normal-ish distribution
    const change = price * volatility * (Math.random() * 2 - 1)
    price = Math.max(price + change, 1) // price can't go below $1

    history.push({
      date: date.toISOString().split('T')[0],  // "YYYY-MM-DD"
      open:  parseFloat((price * (1 - Math.random() * 0.01)).toFixed(2)),
      high:  parseFloat((price * (1 + Math.random() * 0.015)).toFixed(2)),
      low:   parseFloat((price * (1 - Math.random() * 0.015)).toFixed(2)),
      close: parseFloat(price.toFixed(2)),
      volume: Math.floor(Math.random() * 50_000_000 + 5_000_000),
    })
  }
  return history
}

// ── Static stock definitions ──────────────────────────────────
export const STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.',          sector: 'Technology',   startPrice: 178, volatility: 0.018 },
  { symbol: 'MSFT', name: 'Microsoft Corp.',     sector: 'Technology',   startPrice: 415, volatility: 0.016 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',      sector: 'Technology',   startPrice: 175, volatility: 0.020 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.',     sector: 'Consumer',     startPrice: 185, volatility: 0.022 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.',        sector: 'Technology',   startPrice: 875, volatility: 0.035 },
  { symbol: 'TSLA', name: 'Tesla Inc.',          sector: 'Automotive',   startPrice: 175, volatility: 0.045 },
  { symbol: 'META', name: 'Meta Platforms',      sector: 'Technology',   startPrice: 495, volatility: 0.024 },
  { symbol: 'JPM',  name: 'JPMorgan Chase',      sector: 'Finance',      startPrice: 195, volatility: 0.015 },
  { symbol: 'V',    name: 'Visa Inc.',           sector: 'Finance',      startPrice: 275, volatility: 0.013 },
  { symbol: 'WMT',  name: 'Walmart Inc.',        sector: 'Retail',       startPrice: 60,  volatility: 0.012 },
  { symbol: 'JNJ',  name: 'Johnson & Johnson',   sector: 'Healthcare',   startPrice: 155, volatility: 0.011 },
  { symbol: 'XOM',  name: 'Exxon Mobil Corp.',   sector: 'Energy',       startPrice: 110, volatility: 0.020 },
]

// Pre-generate price histories once so data is stable during the session
const priceHistories = {}
STOCKS.forEach(stock => {
  priceHistories[stock.symbol] = generatePriceHistory(
    stock.startPrice,
    120,
    stock.volatility || 0.02
  )
})

/**
 * Get full price history for a given symbol
 */
export function getPriceHistory(symbol) {
  return priceHistories[symbol] || []
}

/**
 * Get the latest price data for a symbol
 */
export function getLatestPrice(symbol) {
  const history = priceHistories[symbol]
  if (!history || history.length === 0) return null
  return history[history.length - 1]
}

/**
 * Get enriched stock info with current price and daily change
 */
export function getStockInfo(symbol) {
  const stock = STOCKS.find(s => s.symbol === symbol)
  if (!stock) return null

  const history = priceHistories[symbol]
  const latest  = history[history.length - 1]
  const prev    = history[history.length - 2]

  const change    = latest.close - prev.close
  const changePct = (change / prev.close) * 100

  return {
    ...stock,
    price:     latest.close,
    change:    parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    high52w:   parseFloat(Math.max(...history.map(d => d.high)).toFixed(2)),
    low52w:    parseFloat(Math.min(...history.map(d => d.low)).toFixed(2)),
    volume:    latest.volume,
  }
}

/**
 * Get enriched info for ALL stocks
 */
export function getAllStockInfo() {
  return STOCKS.map(s => getStockInfo(s.symbol))
}

// ── Default portfolio holdings (for demo purposes) ───────────
export const DEFAULT_PORTFOLIO = [
  { symbol: 'AAPL', shares: 10, avgCost: 165.00 },
  { symbol: 'MSFT', shares: 5,  avgCost: 390.00 },
  { symbol: 'NVDA', shares: 3,  avgCost: 820.00 },
  { symbol: 'TSLA', shares: 8,  avgCost: 190.00 },
  { symbol: 'JPM',  shares: 12, avgCost: 185.00 },
]

// ── Default watchlist ─────────────────────────────────────────
export const DEFAULT_WATCHLIST = ['GOOGL', 'AMZN', 'META', 'V', 'WMT']
