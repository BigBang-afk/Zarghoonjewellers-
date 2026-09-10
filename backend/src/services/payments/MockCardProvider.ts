import { randomUUID, createHmac, timingSafeEqual } from "node:crypto"
import type { AuthorizeResult, CaptureResult, PaymentProvider, RefundResult, StatusResult, TransactionRecord } from "./PaymentProvider.js"
import { env } from "../../config/env.js"

/**
 * Explicitly a MOCK. Stands in for a real card processor (e.g. Stripe)
 * so the card/wallet code paths are exercised end-to-end in dev without
 * real credentials. Per Phase 2 §29 / Phase 4 §4, this is called out
 * clearly as requiring production credentials before going live —
 * `PAYMENTS_PROVIDER_SECRET_KEY` is never read here; wire a real Stripe
 * (or similar) adapter behind `PaymentProvider` and swap it in
 * `services/payments/index.ts` when that credential exists.
 *
 * `verifyWebhookSignature` here is a stand-in HMAC scheme
 * (`PAYMENTS_PROVIDER_WEBHOOK_SECRET`) so the idempotent-webhook path in
 * api/public/webhooks.ts has something real to check against in dev — a
 * production adapter swaps this for the provider's actual scheme (e.g.
 * Stripe's `Stripe-Signature` header format), verified against the raw
 * request body.
 */
export class MockCardProvider implements PaymentProvider {
  readonly method = "card"
  private ledger = new Map<string, TransactionRecord>()

  async authorize(amountRs: number, referenceId: string): Promise<AuthorizeResult> {
    const providerReference = `mock_card_${referenceId}_${randomUUID().slice(0, 8)}`
    this.ledger.set(providerReference, { providerReference, amountRs, status: "authorized", createdAt: new Date().toISOString() })
    return { providerReference, status: "authorized" }
  }
  async capture(providerReference: string): Promise<CaptureResult> {
    const record = this.ledger.get(providerReference)
    if (record) record.status = "captured"
    return { providerReference, status: "captured" }
  }
  async refund(providerReference: string, amountRs: number): Promise<RefundResult> {
    const refundReference = `mock_refund_${randomUUID().slice(0, 8)}`
    this.ledger.set(refundReference, { providerReference: refundReference, amountRs, status: "refunded", createdAt: new Date().toISOString() })
    const original = this.ledger.get(providerReference)
    if (original) original.status = "refunded"
    return { providerReference: refundReference, status: "refunded" }
  }
  async checkStatus(providerReference: string): Promise<StatusResult> {
    const record = this.ledger.get(providerReference)
    return { providerReference, status: record?.status ?? "captured" }
  }
  async transactionLookup(providerReference: string): Promise<TransactionRecord | null> {
    return this.ledger.get(providerReference) ?? null
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false
    const expected = createHmac("sha256", env.paymentsWebhookSecret).update(rawBody).digest("hex")
    const a = Buffer.from(expected)
    const b = Buffer.from(signatureHeader)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
