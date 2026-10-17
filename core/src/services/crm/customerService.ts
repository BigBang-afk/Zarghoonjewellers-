import { z } from "zod";
import { isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import {
  CustomerIdentityConflictError,
  CustomerNotFoundError,
  ForbiddenActionError,
  InvalidStateError,
  ValidationError,
  type IdentityMatch,
} from "../../lib/errors.js";
import {
  emailSchema,
  externalIdentitySchema,
  normalizeEmail,
  normalizeExternalIdentity,
  normalizePhone,
  phoneSchema,
  type ExternalIdentityType,
} from "../../lib/identifiers.js";
import { optionalText, parseInput, patchText, uuidSchema } from "../../lib/validation.js";
import {
  LANGUAGES,
  mapCustomerRow,
  type Customer,
  type CustomerRow,
  type ExternalIdentity,
  type Language,
} from "../../schemas/crm.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { requireStaffActor } from "../staffRules.js";
import { applyDoNotContactTx, findActiveLead, loadCustomer } from "./shared.js";

/**
 * Customer CRM.
 *
 * Identity rules:
 *  - Phone and WhatsApp numbers are normalized to E.164 and treated as one
 *    namespace: a WhatsApp number that equals another customer's phone is the
 *    same identifier.
 *  - Before a customer is created, every supplied identifier is looked up.
 *    One matching customer → that customer is returned (nothing is changed).
 *    Several matching customers → CustomerIdentityConflictError; records are
 *    never merged automatically, and the conflict is written to the audit log
 *    for human review.
 *  - A customer must always keep at least one contact identifier.
 */

const nullablePhone = z.union([z.null(), phoneSchema]);
const nullableEmail = z.union([z.null(), emailSchema]);

export const createCustomerSchema = z
  .object({
    fullName: optionalText(200),
    phone: phoneSchema.optional(),
    whatsappNumber: phoneSchema.optional(),
    email: emailSchema.optional(),
    city: optionalText(100),
    preferredLanguage: z.enum(LANGUAGES).default("unknown"),
    notes: optionalText(5000),
    externalIdentities: z.array(externalIdentitySchema).max(10).default([]),
  })
  .strict()
  .refine((c) => c.phone || c.whatsappNumber || c.email || c.externalIdentities.length > 0, {
    message: "At least one identifier (phone, WhatsApp, email or external identity) is required",
  });
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    fullName: patchText(200),
    phone: nullablePhone.optional(),
    whatsappNumber: nullablePhone.optional(),
    email: nullableEmail.optional(),
    city: patchText(100),
    notes: patchText(5000),
  })
  .strict();
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

export const setPreferredLanguageSchema = z
  .object({
    language: z.enum(LANGUAGES),
    /** The inbound message in which the customer stated the preference. Required for AI actors. */
    evidenceMessageId: uuidSchema.optional(),
  })
  .strict();

export interface IdentityQuery {
  phones: string[];
  email: string | null;
  externalIdentities: { type: ExternalIdentityType; value: string }[];
}

export type IdentityResolution =
  | { status: "none"; matches: [] }
  | { status: "match"; customerId: string; matches: IdentityMatch[] }
  | { status: "conflict"; customerIds: string[]; matches: IdentityMatch[] };

export type CreateCustomerResult =
  | { outcome: "created"; customer: Customer }
  | { outcome: "existing"; customer: Customer; matchedOn: IdentityMatch[] };

/** Looks up every supplied identifier and classifies the result. */
export async function resolveIdentity(db: Db, q: IdentityQuery): Promise<IdentityResolution> {
  const matches: IdentityMatch[] = [];
  const phones = [...new Set(q.phones)];
  if (phones.length > 0) {
    const rows = await db.query<{ id: string; phone: string | null; whatsapp_number: string | null }>(
      `select id, phone, whatsapp_number from customers
        where phone = any($1::text[]) or whatsapp_number = any($1::text[])`,
      [phones],
    );
    for (const r of rows) {
      if (r.phone && phones.includes(r.phone)) matches.push({ identifier: "phone", value: r.phone, customerId: r.id });
      if (r.whatsapp_number && phones.includes(r.whatsapp_number)) {
        matches.push({ identifier: "whatsapp_number", value: r.whatsapp_number, customerId: r.id });
      }
    }
  }
  if (q.email) {
    const row = await queryOne<{ id: string }>(db, `select id from customers where email = $1`, [q.email]);
    if (row) matches.push({ identifier: "email", value: q.email, customerId: row.id });
  }
  if (q.externalIdentities.length > 0) {
    const rows = await db.query<{ customer_id: string; identity_type: string; identity_value: string }>(
      `select customer_id, identity_type, identity_value from customer_identities
        where (identity_type, identity_value) in (select * from unnest($1::text[], $2::text[]))`,
      [q.externalIdentities.map((i) => i.type), q.externalIdentities.map((i) => i.value)],
    );
    for (const r of rows) {
      matches.push({
        identifier: "external_identity",
        value: `${r.identity_type}:${r.identity_value}`,
        customerId: r.customer_id,
      });
    }
  }

  const ids = [...new Set(matches.map((m) => m.customerId))];
  if (ids.length === 0) return { status: "none", matches: [] };
  if (ids.length === 1) return { status: "match", customerId: ids[0]!, matches };
  return { status: "conflict", customerIds: ids.sort(), matches };
}

async function loadIdentities(db: Db, customerId: string): Promise<ExternalIdentity[]> {
  const rows = await db.query<{ identity_type: ExternalIdentityType; identity_value: string; is_verified: boolean }>(
    `select identity_type, identity_value, is_verified from customer_identities where customer_id = $1 order by created_at`,
    [customerId],
  );
  return rows.map((r) => ({ type: r.identity_type, value: r.identity_value, isVerified: r.is_verified }));
}

export function createCustomerService(db: Db) {
  async function auditConflict(ctx: ActionContext, input: unknown, error: CustomerIdentityConflictError) {
    // Written outside the failed transaction so the conflict stays visible for review.
    await recordAction(db, ctx, {
      actionType: "customer_identity_conflict",
      status: "failed",
      input,
      output: { customerIds: error.customerIds, matches: error.matches },
      errorMessage: error.message,
    });
  }

  async function findCustomerById(id: string): Promise<Customer | null> {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const row = await queryOne<CustomerRow>(db, `select * from customers where id = $1`, [customerId]);
    return row ? mapCustomerRow(row) : null;
  }

  async function getCustomer(id: string): Promise<Customer> {
    const customer = await findCustomerById(id);
    if (!customer) throw new CustomerNotFoundError({ id });
    return customer;
  }

  async function findByResolution(q: IdentityQuery): Promise<Customer | null> {
    const res = await resolveIdentity(db, q);
    if (res.status === "none") return null;
    if (res.status === "conflict") throw new CustomerIdentityConflictError(res.customerIds, res.matches);
    return getCustomer(res.customerId);
  }

  /** Matches against both phone and WhatsApp numbers. */
  async function findCustomerByPhone(rawPhone: string): Promise<Customer | null> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new ValidationError("Invalid phone number", [{ path: "phone", message: "Invalid phone number" }]);
    return findByResolution({ phones: [phone], email: null, externalIdentities: [] });
  }

  async function findCustomerByEmail(rawEmail: string): Promise<Customer | null> {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new ValidationError("Invalid email", [{ path: "email", message: "Invalid email address" }]);
    return findByResolution({ phones: [], email, externalIdentities: [] });
  }

  async function findCustomerByExternalIdentity(type: ExternalIdentityType, rawValue: string): Promise<Customer | null> {
    const identity = parseInput(externalIdentitySchema, { type, value: rawValue }, "external identity");
    const value = normalizeExternalIdentity(identity.type, identity.value)!;
    return findByResolution({ phones: [], email: null, externalIdentities: [{ type: identity.type, value }] });
  }

  async function createCustomer(input: CreateCustomerInput, ctx: ActionContext): Promise<CreateCustomerResult> {
    const data = parseInput(createCustomerSchema, input, "customer");
    const query: IdentityQuery = {
      phones: [data.phone, data.whatsappNumber].filter((p): p is string => !!p),
      email: data.email ?? null,
      externalIdentities: data.externalIdentities,
    };

    const attempt = () =>
      db.transaction(async (tx): Promise<CreateCustomerResult> => {
        const res = await resolveIdentity(tx, query);
        if (res.status === "conflict") throw new CustomerIdentityConflictError(res.customerIds, res.matches);
        if (res.status === "match") {
          return { outcome: "existing", customer: await loadCustomer(tx, res.customerId), matchedOn: res.matches };
        }
        const row = await queryOne<CustomerRow>(
          tx,
          `insert into customers (full_name, phone, whatsapp_number, email, city, preferred_language, notes)
           values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [
            data.fullName,
            data.phone ?? null,
            data.whatsappNumber ?? null,
            data.email ?? null,
            data.city,
            data.preferredLanguage,
            data.notes,
          ],
        );
        const customer = mapCustomerRow(row!);
        for (const identity of data.externalIdentities) {
          await tx.query(
            `insert into customer_identities (customer_id, identity_type, identity_value) values ($1, $2, $3)`,
            [customer.id, identity.type, identity.value],
          );
        }
        await recordAction(tx, ctx, {
          actionType: "customer_created",
          customerId: customer.id,
          input: data,
          output: { customerId: customer.id },
        });
        return { outcome: "created", customer };
      });

    const run = async () => {
      try {
        return await attempt();
      } catch (error) {
        if (error instanceof CustomerIdentityConflictError) await auditConflict(ctx, data, error);
        throw error;
      }
    };
    try {
      return await run();
    } catch (error) {
      // A concurrent request created the same identifier between our lookup
      // and insert: resolve again, which now returns the match or conflict.
      if (isUniqueViolation(error)) return run();
      throw error;
    }
  }

  async function updateCustomer(id: string, input: UpdateCustomerInput, ctx: ActionContext): Promise<Customer> {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const patch = parseInput(updateCustomerSchema, input, "customer update");
    try {
      return await db.transaction(async (tx) => {
        const current = await loadCustomer(tx, customerId, true);
        const next = {
          phone: patch.phone === undefined ? current.phone : patch.phone,
          whatsappNumber: patch.whatsappNumber === undefined ? current.whatsappNumber : patch.whatsappNumber,
          email: patch.email === undefined ? current.email : patch.email,
        };
        const identities = await loadIdentities(tx, customerId);
        if (!next.phone && !next.whatsappNumber && !next.email && identities.length === 0) {
          throw new ValidationError("A customer must keep at least one contact identifier");
        }

        // New identifiers must not already belong to someone else.
        const res = await resolveIdentity(tx, {
          phones: [next.phone, next.whatsappNumber].filter((p): p is string => !!p),
          email: next.email,
          externalIdentities: [],
        });
        const foreign = res.matches.filter((m) => m.customerId !== customerId);
        if (foreign.length > 0) {
          throw new CustomerIdentityConflictError(
            [...new Set([customerId, ...foreign.map((m) => m.customerId)])].sort(),
            foreign,
          );
        }

        const columns: Record<keyof typeof patch, string> = {
          fullName: "full_name",
          phone: "phone",
          whatsappNumber: "whatsapp_number",
          email: "email",
          city: "city",
          notes: "notes",
        };
        const entries = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== undefined);
        if (entries.length === 0) return current;
        const sets = entries.map((k, i) => `${columns[k]} = $${i + 2}`);
        const row = await queryOne<CustomerRow>(
          tx,
          `update customers set ${sets.join(", ")} where id = $1 returning *`,
          [customerId, ...entries.map((k) => patch[k] ?? null)],
        );
        const updated = mapCustomerRow(row!);
        await recordAction(tx, ctx, {
          actionType: "customer_updated",
          customerId,
          input: patch,
          output: {
            changed: Object.fromEntries(
              entries.map((k) => [k, { from: current[k as keyof Customer] ?? null, to: updated[k as keyof Customer] ?? null }]),
            ),
          },
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof CustomerIdentityConflictError) {
        await auditConflict(ctx, { customerId, ...patch }, error);
        throw error;
      }
      if (isUniqueViolation(error)) {
        const conflict = new CustomerIdentityConflictError([customerId], []);
        await auditConflict(ctx, { customerId, ...patch }, conflict);
        throw conflict;
      }
      throw error;
    }
  }

  /**
   * Preferred language is never inferred permanently from a single message.
   * It changes only when staff set it, or when the AI cites the inbound
   * message in which the customer explicitly stated it.
   */
  async function setPreferredLanguage(
    id: string,
    input: z.input<typeof setPreferredLanguageSchema>,
    ctx: ActionContext,
  ): Promise<Customer> {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const data = parseInput(setPreferredLanguageSchema, input, "preferred language");
    return db.transaction(async (tx) => {
      const current = await loadCustomer(tx, customerId, true);
      if (ctx.actor.type !== "staff") {
        if (!data.evidenceMessageId) {
          throw new ForbiddenActionError("Automated actors must cite the customer's message stating their language", {
            customerId,
          });
        }
        const evidence = await queryOne<{ ok: boolean }>(
          tx,
          `select true as ok from messages m join conversations c on c.id = m.conversation_id
            where m.id = $1 and m.direction = 'inbound' and c.customer_id = $2`,
          [data.evidenceMessageId, customerId],
        );
        if (!evidence) {
          throw new InvalidStateError("Evidence must be an inbound message from this customer", {
            evidenceMessageId: data.evidenceMessageId,
          });
        }
      }
      const row = await queryOne<CustomerRow>(
        tx,
        `update customers set preferred_language = $2 where id = $1 returning *`,
        [customerId, data.language],
      );
      await recordAction(tx, ctx, {
        actionType: "customer_language_set",
        customerId,
        input: data,
        output: { from: current.preferredLanguage, to: data.language },
      });
      return mapCustomerRow(row!);
    });
  }

  async function linkExternalIdentity(
    id: string,
    input: { type: ExternalIdentityType; value: string },
    ctx: ActionContext,
  ): Promise<ExternalIdentity[]> {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const identity = parseInput(externalIdentitySchema, input, "external identity");
    return db.transaction(async (tx) => {
      await loadCustomer(tx, customerId, true);
      const res = await resolveIdentity(tx, { phones: [], email: null, externalIdentities: [identity] });
      if (res.status === "match" && res.customerId === customerId) return loadIdentities(tx, customerId);
      if (res.status !== "none") {
        throw new CustomerIdentityConflictError([customerId, ...res.matches.map((m) => m.customerId)].sort(), res.matches);
      }
      await tx.query(`insert into customer_identities (customer_id, identity_type, identity_value) values ($1, $2, $3)`, [
        customerId,
        identity.type,
        identity.value,
      ]);
      await recordAction(tx, ctx, { actionType: "customer_identity_linked", customerId, input: identity });
      return loadIdentities(tx, customerId);
    });
  }

  /** Any actor may record a do-not-contact request — honouring it must never be blocked. */
  async function setDoNotContact(id: string, ctx: ActionContext, reason?: string) {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const note = parseInput(optionalText(1000), reason, "reason");
    return db.transaction((tx) => applyDoNotContactTx(tx, customerId, ctx, note));
  }

  /** Only staff can lift a do-not-contact flag (e.g. the customer re-engaged in person). */
  async function clearDoNotContact(id: string, ctx: ActionContext, reason: string): Promise<Customer> {
    const customerId = parseInput(uuidSchema, id, "customer id");
    const note = parseInput(z.string().trim().min(1).max(1000), reason, "reason");
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "clear do-not-contact");
      await loadCustomer(tx, customerId, true);
      const row = await queryOne<CustomerRow>(
        tx,
        `update customers set do_not_contact = false, do_not_contact_at = null where id = $1 returning *`,
        [customerId],
      );
      await recordAction(tx, ctx, { actionType: "do_not_contact_cleared", customerId, input: { reason: note } });
      return mapCustomerRow(row!);
    });
  }

  async function getCustomerSummary(id: string) {
    const customer = await getCustomer(id);
    const [activeLead, counts, externalIdentities] = await Promise.all([
      findActiveLead(db, customer.id),
      queryOne<{ open_conversations: number; pending_followups: number; orders: number }>(
        db,
        `select
           (select count(*)::int from conversations where customer_id = $1 and status = 'open') as open_conversations,
           (select count(*)::int from followups where customer_id = $1 and status = 'pending') as pending_followups,
           (select count(*)::int from orders where customer_id = $1) as orders`,
        [customer.id],
      ),
      loadIdentities(db, customer.id),
    ]);
    return {
      customer,
      externalIdentities,
      activeLead: activeLead
        ? { id: activeLead.id, status: activeLead.status, score: activeLead.score, classification: activeLead.scoreClassification }
        : null,
      openConversations: counts!.open_conversations,
      pendingFollowups: counts!.pending_followups,
      totalOrders: counts!.orders,
    };
  }

  return {
    findCustomerById,
    getCustomer,
    findCustomerByPhone,
    findCustomerByEmail,
    findCustomerByExternalIdentity,
    resolveIdentity: (q: IdentityQuery) => resolveIdentity(db, q),
    createCustomer,
    updateCustomer,
    setPreferredLanguage,
    linkExternalIdentity,
    getExternalIdentities: async (id: string) => loadIdentities(db, parseInput(uuidSchema, id, "customer id")),
    setDoNotContact,
    clearDoNotContact,
    getCustomerSummary,
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
