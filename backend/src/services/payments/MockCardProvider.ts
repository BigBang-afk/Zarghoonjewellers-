import { randomUUID } from "node:crypto"
import type { AuthorizeResult, CaptureResult, PaymentProvider, RefundResult } from "./PaymentProvider.js"

/**
 * Explicitly a MOCK. Stands in for a real card processor (e.g. Stripe)
 * so the card/wallet code paths are exercised end-to-end in dev without
 * real credentials. Per Phase 2 §29, this is called out clearly as
 * requiring production credentials before going live —
 * `PAYMENTS_PROVIDER_SECRET_KEY` is never read here; wire a real Stripe
 * (or similar) adapter behind `PaymentProvider` and swap it in
 * `services/payments/index.ts` when that credential exists.
 */
export class MockCardProvider implements PaymentProvider {
  readonly method = "card"

  async authorize(_amountRs: number, referenceId: string): Promise<AuthorizeResult> {
    return { providerReference: `mock_card_${referenceId}_${randomUUID().slice(0, 8)}`, status: "authorized" }
  }
  async capture(providerReference: string): Promise<CaptureResult> {
    return { providerReference, status: "captured" }
  }
  async refund(_providerReference: string, _amountRs: number): Promise<RefundResult> {
    return { providerReference: `mock_refund_${randomUUID().slice(0, 8)}`, status: "refunded" }
  }
}
