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

/**
 * Provider-agnostic payment interface (docs/06 §6). The Payment/Wallet
 * services depend only on this — adding a new method (a local provider
 * like JazzCash/Easypaisa, or a card processor like Stripe) means adding
 * an adapter class, never touching ride or wallet logic.
 */
export interface PaymentProvider {
  readonly method: string
  authorize(amountRs: number, referenceId: string): Promise<AuthorizeResult>
  capture(providerReference: string): Promise<CaptureResult>
  refund(providerReference: string, amountRs: number): Promise<RefundResult>
}
