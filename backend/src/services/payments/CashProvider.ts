import { randomUUID } from "node:crypto"
import type { AuthorizeResult, CaptureResult, PaymentProvider, RefundResult, StatusResult, TransactionRecord } from "./PaymentProvider.js"

/**
 * Cash needs no external gateway — this adapter just records a reference
 * so cash payments flow through the exact same Payment/Transaction
 * pipeline as any other method. This is real (not mocked) in the sense
 * that it's the actual production behavior for cash.
 */
export class CashProvider implements PaymentProvider {
  readonly method = "cash"
  private ledger = new Map<string, TransactionRecord>()

  async authorize(amountRs: number, referenceId: string): Promise<AuthorizeResult> {
    const providerReference = `cash_${referenceId}`
    this.ledger.set(providerReference, { providerReference, amountRs, status: "authorized", createdAt: new Date().toISOString() })
    return { providerReference, status: "authorized" }
  }
  async capture(providerReference: string): Promise<CaptureResult> {
    const record = this.ledger.get(providerReference)
    if (record) record.status = "captured"
    return { providerReference, status: "captured" }
  }
  async refund(_providerReference: string, amountRs: number): Promise<RefundResult> {
    const providerReference = `cash_refund_${randomUUID()}`
    this.ledger.set(providerReference, { providerReference, amountRs, status: "refunded", createdAt: new Date().toISOString() })
    return { providerReference, status: "refunded" }
  }
  async checkStatus(providerReference: string): Promise<StatusResult> {
    const record = this.ledger.get(providerReference)
    return { providerReference, status: record?.status ?? "captured" }
  }
  async transactionLookup(providerReference: string): Promise<TransactionRecord | null> {
    return this.ledger.get(providerReference) ?? null
  }
}
