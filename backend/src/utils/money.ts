/**
 * Currency abstraction (Phase 4 §3) — RIVO must never assume every
 * currency formats like PKR (two decimals, symbol-then-amount). Every
 * money value in the system is stored as a plain Float alongside its own
 * `currencyCode` column (SQLite has no native Decimal — see
 * prisma/schema.prisma's header for the documented Postgres upgrade
 * path); this module is the one place that knows how to round and
 * display a given currency correctly.
 */
export interface CurrencyMeta {
  code: string
  symbol: string
  /** Decimal places this currency is conventionally quoted to (e.g. JPY uses 0). */
  decimals: number
}

const CURRENCIES: Record<string, CurrencyMeta> = {
  PKR: { code: "PKR", symbol: "Rs", decimals: 2 },
  AED: { code: "AED", symbol: "AED", decimals: 2 },
  SAR: { code: "SAR", symbol: "SAR", decimals: 2 },
  USD: { code: "USD", symbol: "$", decimals: 2 },
  GBP: { code: "GBP", symbol: "£", decimals: 2 },
  EUR: { code: "EUR", symbol: "€", decimals: 2 },
  INR: { code: "INR", symbol: "₹", decimals: 2 },
  JPY: { code: "JPY", symbol: "¥", decimals: 0 },
  KWD: { code: "KWD", symbol: "KD", decimals: 3 },
  BHD: { code: "BHD", symbol: "BD", decimals: 3 },
}

/** Unknown currency codes still work (never throws) — just formatted plainly. */
export function getCurrencyMeta(code: string): CurrencyMeta {
  const upper = code.toUpperCase()
  return CURRENCIES[upper] ?? { code: upper, symbol: upper, decimals: 2 }
}

export function roundMoney(amount: number, currencyCode: string): number {
  const { decimals } = getCurrencyMeta(currencyCode)
  const factor = 10 ** decimals
  return Math.round(amount * factor) / factor
}

/** e.g. formatMoney(1234.5, "PKR") -> "Rs 1,234.50"; formatMoney(500, "JPY") -> "¥500" */
export function formatMoney(amount: number, currencyCode: string): string {
  const meta = getCurrencyMeta(currencyCode)
  const formatted = amount.toLocaleString(undefined, { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals })
  return `${meta.symbol} ${formatted}`
}
