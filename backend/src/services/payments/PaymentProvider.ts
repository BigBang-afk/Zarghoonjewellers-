export interface AuthorizeResult {
  providerReference: string
  status: "authorized" | "failed"
}
export interface CaptureResult {
  providerReference: string
  status: "captured" | "failed"
}
export interface RefundResult {
  providerReference: string
  status: "refunded" | "failed"
}
export interface StatusResult {
  providerReference: string
  status: "pending" | "authorized" | "captured" | "refunded" | "failed"
}
/** A minimal, provider-agnostic view of one transaction for support/reconciliation lookups. */
export interface TransactionRecord {
  providerReference: string
  amountRs: number
  status: StatusResult["status"]
  createdAt: string
}

/**
 * Provider-agnostic payment interface (docs/06 §6, Phase 4 §4). The
 * Payment/Wallet services depend only on this — adding a new method (a
 * local provider like JazzCash/Easypaisa, or a card processor like
 * Stripe) means adding an adapter class, never touching ride or wallet
 * logic.
 *
 * `checkStatus` and `transactionLookup` exist for reconciliation and
 * support tooling (Phase 4 §4/§28) — a real adapter calls the provider's
 * API; the mock adapters below answer from what they already know since
 * they have no external system to actually query.
 *
 * `verifyWebhookSignature` is optional because not every provider uses
 * the same scheme, and cash has no webhooks at all. A real adapter
 * verifies against `RAW request body bytes`, not the parsed JSON — see
 * `api/public/webhooks.ts` for why the webhook route reads a raw body
 * ahead of the global JSON parser.
 */
export interface PaymentProvider {
  readonly method: string
  authorize(amountRs: number, referenceId: string): Promise<AuthorizeResult>
  capture(providerReference: string): Promise<CaptureResult>
  refund(providerReference: string, amountRs: number): Promise<RefundResult>
  checkStatus(providerReference: string): Promise<StatusResult>
  transactionLookup(providerReference: string): Promise<TransactionRecord | null>
  verifyWebhookSignature?(rawBody: string, signatureHeader: string | undefined): boolean
}
