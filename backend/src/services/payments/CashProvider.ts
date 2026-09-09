import { randomUUID } from "node:crypto"
import type { AuthorizeResult, CaptureResult, PaymentProvider, RefundResult } from "./PaymentProvider.js"

/**
 * Cash needs no external gateway — this adapter just records a reference
 * so cash payments flow through the exact same Payment/Transaction
 * pipeline as any other method. This is real (not mocked) in the sense
 * that it's the actual production behavior for cash.
 */
export class CashProvider implements PaymentProvider {
  readonly method = "cash"

  async authorize(_amountRs: number, referenceId: string): Promise<AuthorizeResult> {
    return { providerReference: `cash_${referenceId}`, status: "authorized" }
  }
  async capture(providerReference: string): Promise<CaptureResult> {
    return { providerReference, status: "captured" }
  }
  async refund(_providerReference: string, _amountRs: number): Promise<RefundResult> {
    return { providerReference: `cash_refund_${randomUUID()}`, status: "refunded" }
  }
}
