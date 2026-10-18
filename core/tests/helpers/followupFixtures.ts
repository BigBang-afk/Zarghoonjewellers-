import type { Db } from "../../src/database/db.js";
import { createZarghoonCore } from "../../src/index.js";
import { createFollowupEngine } from "../../src/services/followupEngine/engineService.js";
import type { FollowupDrafter } from "../../src/services/followupEngine/drafting.js";
import type { Clock } from "../../src/types/context.js";
import { AI_CTX, insertProduct, insertStaff, staffCtx, SYSTEM_CTX } from "./fixtures.js";

/** Fake staff, customers and products for follow-up engine tests. */
export interface FollowupWorld {
  manager: string;
  ali: string;
  sara: string;
  necklace: string; // approved price, unknown stock
  bangle: string; // approved price, available
  customer: string; // consent granted, lead assigned to Ali, interest in the necklace, a conversation
  lead: string;
  conversation: string;
}

/**
 * The next 12:00 in Karachi that is at least an hour from now (outside quiet
 * hours). Relative to the real clock, because record timestamps come from the
 * database's now().
 */
function nextNoonPkt(): Date {
  const DAY = 86_400_000;
  const noonToday = Math.floor((Date.now() + 5 * 3_600_000) / DAY) * DAY + 7 * 3_600_000; // 12:00 PKT = 07:00Z
  return new Date(noonToday > Date.now() + 3_600_000 ? noonToday : noonToday + DAY);
}
export const NOON_PKT = nextNoonPkt();
export const at = (hoursAfterNoon: number) => new Date(NOON_PKT.getTime() + hoursAfterNoon * 3_600_000);

export async function createWorld(db: Db, clock: Clock = () => NOON_PKT, options: { consent?: "granted" | "unknown" } = {}): Promise<FollowupWorld> {
  const core = createZarghoonCore({ db, clock });
  const manager = await insertStaff(db, { fullName: "TEST Manager", role: "manager" });
  const ali = await insertStaff(db, { fullName: "TEST Ali", role: "sales" });
  const sara = await insertStaff(db, { fullName: "TEST Sara", role: "sales" });
  const necklace = await insertProduct(db, { sku: "TEST-NK-001", name: "TEST Bridal Necklace", collection: "bridal", approvedPrice: "485000.00", stockStatus: null, stockQuantity: null });
  const bangle = await insertProduct(db, { sku: "TEST-BG-001", name: "TEST Bangles", category: "bangle", collection: null, approvedPrice: "298000.00", stockStatus: "available", stockQuantity: 2 });
  const { customer } = await core.customers.createCustomer({ fullName: "TEST Customer", email: "test.customer@example.invalid", preferredLanguage: "english" }, SYSTEM_CTX);
  const lead = await core.leads.createLead({ customerId: customer.id, sourceChannel: "website", assignedStaffId: ali }, SYSTEM_CTX);
  const conversation = await core.conversations.createConversation({ channel: "website", customerId: customer.id, leadId: lead.id }, SYSTEM_CTX);
  await core.conversations.addMessage({ conversationId: conversation.id, direction: "inbound", senderType: "customer", content: "I want a bridal necklace" }, SYSTEM_CTX);
  await core.productInterests.recordProductInterest({ customerId: customer.id, productId: necklace, interestType: "asked_price" }, AI_CTX);
  if ((options.consent ?? "granted") === "granted") {
    await createFollowupEngine(db, { clock }).setContactConsent(customer.id, "granted", "TEST — consent recorded", staffCtx(manager));
  }
  return { manager, ali, sara, necklace, bangle, customer: customer.id, lead: lead.id, conversation: conversation.id };
}

export const engineWith = (db: Db, clock: Clock = () => NOON_PKT, drafter?: FollowupDrafter) => createFollowupEngine(db, { clock, drafter });

let n = 0;
export const key = (label = "k") => `test-${label}-${process.pid}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
