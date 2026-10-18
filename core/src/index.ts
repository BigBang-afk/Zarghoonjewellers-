import type { Db } from "./database/db.js";
import { createApprovalService } from "./services/approvalService.js";
import { createAuditService } from "./services/auditService.js";
import { createConversationService } from "./services/crm/conversationService.js";
import { createCustomer360Service } from "./services/crm/customer360Service.js";
import { createCustomerService } from "./services/crm/customerService.js";
import { createFollowupService } from "./services/crm/followupService.js";
import { createHandoffService } from "./services/crm/handoffService.js";
import { createLeadService } from "./services/crm/leadService.js";
import { createProductInterestService } from "./services/crm/productInterestService.js";
import { createProductImportService } from "./services/products/import/productImportService.js";
import { createProductService } from "./services/products/productService.js";
import { createProductSyncService } from "./services/products/sync/productSyncService.js";
import { systemClock, type Clock } from "./types/context.js";

/**
 * Composition root. Every business capability is a validated service function
 * over one database handle. Future API routes and AI tools call these — they
 * never run SQL themselves.
 */
export function createZarghoonCore(options: { db: Db; clock?: Clock }) {
  const { db } = options;
  const clock = options.clock ?? systemClock;
  return {
    products: createProductService(db),
    productImport: createProductImportService(db),
    productSync: createProductSyncService(db),
    customers: createCustomerService(db),
    leads: createLeadService(db),
    productInterests: createProductInterestService(db),
    conversations: createConversationService(db),
    followups: createFollowupService(db, clock),
    handoffs: createHandoffService(db),
    customer360: createCustomer360Service(db),
    approvals: createApprovalService(db),
    audit: createAuditService(db),
  };
}

export type ZarghoonCore = ReturnType<typeof createZarghoonCore>;

export { createPgDb, type Db } from "./database/db.js";
export * from "./lib/errors.js";
export type { ActionContext, Actor, Clock } from "./types/context.js";
export { computeLeadScore, classifyLeadScore, LEAD_SIGNAL_POINTS } from "./services/crm/leadScoring.js";
export { createLogger, type Logger } from "./lib/logger.js";
export { createFollowupEngine, type FollowupEngine } from "./services/followupEngine/engineService.js";
export { createFollowupWorker, type FollowupWorker, type WorkerRunSummary } from "./services/followupEngine/worker.js";
export { createClaudeDrafter, createTemplateDrafter, type FollowupDrafter } from "./services/followupEngine/drafting.js";
