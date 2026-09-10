/** Mirrors backend/src/utils/money.ts — never assume every currency formats like PKR. */
export interface CurrencyMeta {
  code: string
  symbol: string
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

export function getCurrencyMeta(code: string): CurrencyMeta {
  const upper = code.toUpperCase()
  return CURRENCIES[upper] ?? { code: upper, symbol: upper, decimals: 2 }
}

export function formatMoney(amount: number, currencyCode: string): string {
  const meta = getCurrencyMeta(currencyCode)
  const formatted = amount.toLocaleString(undefined, { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals })
  return `${meta.symbol} ${formatted}`
}
