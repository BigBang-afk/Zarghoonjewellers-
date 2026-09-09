import type { PaymentProvider } from "./PaymentProvider.js"
import { CashProvider } from "./CashProvider.js"
import { MockCardProvider } from "./MockCardProvider.js"

const providers: Record<string, PaymentProvider> = {
  cash: new CashProvider(),
  // "wallet" and "local_provider" payment methods reuse the mock card
  // adapter's behavior for Phase 2 (they all just need to authorize/
  // capture/refund) — give each its own real adapter class in Phase 3.
  card: new MockCardProvider(),
  wallet: new MockCardProvider(),
  local_provider: new MockCardProvider(),
}

export function getPaymentProvider(method: string): PaymentProvider {
  const provider = providers[method]
  if (!provider) throw new Error(`No PaymentProvider configured for method "${method}"`)
  return provider
}

export type { PaymentProvider } from "./PaymentProvider.js"
