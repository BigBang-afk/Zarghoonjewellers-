import { z } from "zod";
import { hasDbHint, isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import {
  ConversationClosedError,
  DuplicateConversationError,
  HumanTakeoverActiveError,
  InvalidStateError,
  ValidationError,
} from "../../lib/errors.js";
import { findSecrets } from "../../lib/redact.js";
import { optionalText, parseInput, uuidSchema } from "../../lib/validation.js";
import {
  CHANNELS,
  LANGUAGES,
  MESSAGE_DIRECTIONS,
  SENDER_TYPES,
  mapConversationRow,
  mapMessageRow,
  type Conversation,
  type ConversationRow,
  type ConversationStatus,
  type Message,
  type MessageRow,
} from "../../schemas/crm.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { onCustomerReplyTx } from "../followupEngine/hooks.js";
import { assertAssignableStaff, requireStaffActor } from "../staffRules.js";
import { assertLeadBelongsTo, loadConversation, loadCustomer, loadLead } from "./shared.js";

/**
 * Conversations and message history, channel-agnostic. Future channels
 * (WhatsApp, Instagram…) normalize their payloads into `addMessage`.
 *
 * Human takeover: while a conversation is under human control, AI-authored
 * messages are rejected here AND by a database trigger. Only staff can hand
 * control back to the AI.
 */

const MAX_METADATA_BYTES = 16 * 1024;

export const createConversationSchema = z
  .object({
    channel: z.enum(CHANNELS),
    customerId: uuidSchema.optional(),
    leadId: uuidSchema.optional(),
    externalConversationId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type CreateConversationInput = z.input<typeof createConversationSchema>;

export const addMessageSchema = z
  .object({
    conversationId: uuidSchema,
    direction: z.enum(MESSAGE_DIRECTIONS),
    senderType: z.enum(SENDER_TYPES),
    senderStaffId: uuidSchema.optional(),
    content: z.string().trim().min(1, "Message content is required").max(10_000),
    /** Detected language of this message only; never copied to the customer profile. */
    language: z.enum(LANGUAGES).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    externalMessageId: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine(
    (m) =>
      (m.direction === "inbound" && m.senderType === "customer") ||
      (m.direction === "outbound" && m.senderType !== "customer"),
    { message: "Inbound messages come from customers; outbound messages from ai, staff or system" },
  )
  .refine((m) => m.senderType !== "staff" || !!m.senderStaffId, {
    message: "Staff messages require senderStaffId",
    path: ["senderStaffId"],
  });
export type AddMessageInput = z.input<typeof addMessageSchema>;

export interface AddMessageResult {
  message: Message;
  /** True when externalMessageId was already stored (idempotent channel redelivery). */
  duplicate: boolean;
}

export function createConversationService(db: Db) {
  async function createConversation(input: CreateConversationInput, ctx: ActionContext): Promise<Conversation> {
    const data = parseInput(createConversationSchema, input, "conversation");
    try {
      return await db.transaction(async (tx) => {
        if (data.customerId) await loadCustomer(tx, data.customerId);
        if (data.leadId) {
          if (!data.customerId) throw new ValidationError("leadId requires customerId");
          assertLeadBelongsTo(await loadLead(tx, data.leadId), data.customerId);
        }
        const row = await queryOne<ConversationRow>(
          tx,
          `insert into conversations (channel, customer_id, lead_id, external_conversation_id)
           values ($1, $2, $3, $4) returning *`,
          [data.channel, data.customerId ?? null, data.leadId ?? null, data.externalConversationId ?? null],
        );
        const conversation = mapConversationRow(row!);
        await recordAction(tx, ctx, {
          actionType: "conversation_created",
          customerId: conversation.customerId,
          leadId: conversation.leadId,
          conversationId: conversation.id,
          input: data,
        });
        return conversation;
      });
    } catch (error) {
      if (isUniqueViolation(error, "conversations_external_key")) {
        const existing = await queryOne<{ id: string }>(
          db,
          `select id from conversations where channel = $1 and external_conversation_id = $2`,
          [data.channel, data.externalConversationId],
        );
        throw new DuplicateConversationError(data.channel, data.externalConversationId!, existing?.id ?? null);
      }
      throw error;
    }
  }

  async function getConversation(id: string): Promise<Conversation> {
    return loadConversation(db, parseInput(uuidSchema, id, "conversation id"));
  }

  async function findConversationByExternalId(channel: string, externalConversationId: string) {
    const ch = parseInput(z.enum(CHANNELS), channel, "channel");
    const row = await queryOne<ConversationRow>(
      db,
      `select * from conversations where channel = $1 and external_conversation_id = $2`,
      [ch, externalConversationId],
    );
    return row ? mapConversationRow(row) : null;
  }

  async function getCustomerConversations(
    customerId: string,
    options: { status?: ConversationStatus; limit?: number } = {},
  ): Promise<Conversation[]> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const rows = await db.query<ConversationRow>(
      `select * from conversations where customer_id = $1 and ($2::text is null or status = $2)
        order by coalesce(last_message_at, created_at) desc limit $3`,
      [id, options.status ?? null, Math.min(options.limit ?? 20, 200)],
    );
    return rows.map(mapConversationRow);
  }

  /** Links an anonymous conversation to the customer once they are identified. */
  async function attachCustomer(
    conversationId: string,
    input: { customerId: string; leadId?: string },
    ctx: ActionContext,
  ): Promise<Conversation> {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    const data = parseInput(z.object({ customerId: uuidSchema, leadId: uuidSchema.optional() }).strict(), input, "attach");
    return db.transaction(async (tx) => {
      const current = await loadConversation(tx, id, true);
      if (current.customerId && current.customerId !== data.customerId) {
        throw new InvalidStateError("Conversation is already linked to a different customer", { conversationId: id });
      }
      await loadCustomer(tx, data.customerId);
      if (data.leadId) assertLeadBelongsTo(await loadLead(tx, data.leadId), data.customerId);
      const row = await queryOne<ConversationRow>(
        tx,
        `update conversations set customer_id = $2, lead_id = coalesce($3, lead_id) where id = $1 returning *`,
        [id, data.customerId, data.leadId ?? null],
      );
      await recordAction(tx, ctx, {
        actionType: "conversation_customer_attached",
        conversationId: id,
        customerId: data.customerId,
        leadId: data.leadId ?? null,
      });
      return mapConversationRow(row!);
    });
  }

  async function addMessage(input: AddMessageInput, ctx: ActionContext): Promise<AddMessageResult> {
    const data = parseInput(addMessageSchema, input, "message");
    const secretPaths = findSecrets(data.metadata);
    if (secretPaths.length > 0) {
      throw new ValidationError("Message metadata must not contain secrets", secretPaths.map((p) => ({
        path: `metadata.${p}`,
        message: "Secret-like value not allowed",
      })));
    }
    if (Buffer.byteLength(JSON.stringify(data.metadata)) > MAX_METADATA_BYTES) {
      throw new ValidationError("Message metadata is too large");
    }

    try {
      return await db.transaction(async (tx) => {
        const conversation = await loadConversation(tx, data.conversationId, true);
        if (conversation.status === "closed") throw new ConversationClosedError(conversation.id);
        if (data.senderType === "ai" && conversation.humanTakeover) {
          throw new HumanTakeoverActiveError(conversation.id);
        }

        const inserted = await tx.query<MessageRow>(
          `insert into messages (conversation_id, direction, sender_type, sender_staff_id, content, language, metadata, external_message_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (conversation_id, external_message_id) where external_message_id is not null do nothing
           returning *`,
          [
            conversation.id,
            data.direction,
            data.senderType,
            data.senderStaffId ?? null,
            data.content,
            data.language ?? null,
            JSON.stringify(data.metadata),
            data.externalMessageId ?? null,
          ],
        );
        if (inserted.length === 0) {
          const existing = await queryOne<MessageRow>(
            tx,
            `select * from messages where conversation_id = $1 and external_message_id = $2`,
            [conversation.id, data.externalMessageId],
          );
          return { message: mapMessageRow(existing!), duplicate: true };
        }
        const message = mapMessageRow(inserted[0]!);

        await tx.query(`update conversations set last_message_at = $2 where id = $1`, [conversation.id, message.createdAt]);
        if (conversation.customerId) {
          await tx.query(`update customers set last_contact_at = $2 where id = $1`, [
            conversation.customerId,
            message.createdAt,
          ]);
        }
        if (conversation.customerId && data.direction === "inbound") {
          // The customer replied: outstanding outreach goes back to staff for review.
          await onCustomerReplyTx(tx, conversation.customerId, message.createdAt, ctx);
        }
        if (conversation.leadId && data.direction === "inbound") {
          await tx.query(
            `update leads set last_activity_at = $2 where id = $1 and status not in ('won', 'lost', 'do_not_contact')`,
            [conversation.leadId, message.createdAt],
          );
        }
        if (data.senderType === "ai") {
          await recordAction(tx, ctx, {
            actionType: "ai_message_sent",
            customerId: conversation.customerId,
            leadId: conversation.leadId,
            conversationId: conversation.id,
            output: { messageId: message.id, length: message.content.length },
          });
        }
        return { message, duplicate: false };
      });
    } catch (error) {
      if (error instanceof HumanTakeoverActiveError || hasDbHint(error, "ZJ_HUMAN_TAKEOVER_ACTIVE")) {
        // Audit the blocked attempt outside the rolled-back transaction.
        await recordAction(db, ctx, {
          actionType: "ai_message_blocked",
          conversationId: data.conversationId,
          status: "rejected",
          errorMessage: "human takeover active",
          output: { contentLength: data.content.length },
        });
        throw error instanceof HumanTakeoverActiveError ? error : new HumanTakeoverActiveError(data.conversationId);
      }
      throw error;
    }
  }

  /** Returns the most recent `limit` messages in chronological order. */
  async function getRecentMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    const rows = await db.query<MessageRow>(
      `select * from (
         select * from messages where conversation_id = $1 order by created_at desc, id desc limit $2
       ) recent order by created_at asc, id asc`,
      [id, Math.min(limit, 200)],
    );
    return rows.map(mapMessageRow);
  }

  /**
   * Activating takeover is allowed for any actor (stopping the AI is always
   * safe). Releasing it is staff-only and resolves any open handoffs.
   * Prefer `requestHumanHandoff` for AI-initiated escalation — it also
   * records the reason and urgency.
   */
  async function setHumanTakeover(
    conversationId: string,
    input: { active: boolean; reason?: string },
    ctx: ActionContext,
  ): Promise<Conversation> {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    const data = parseInput(z.object({ active: z.boolean(), reason: optionalText(500) }).strict(), input, "takeover");
    return db.transaction(async (tx) => {
      let staffId: string | null = null;
      if (!data.active) staffId = (await requireStaffActor(tx, ctx, "release a human takeover")).id;
      const current = await loadConversation(tx, id, true);
      const row = await queryOne<ConversationRow>(
        tx,
        data.active
          ? `update conversations set human_takeover = true, human_takeover_at = coalesce(human_takeover_at, now()),
                    human_takeover_reason = coalesce($2, human_takeover_reason) where id = $1 returning *`
          : `update conversations set human_takeover = false, human_takeover_at = null, human_takeover_reason = null
              where id = $1 returning *`,
        [id, ...(data.active ? [data.reason] : [])],
      );
      if (!data.active) {
        await tx.query(
          `update handoffs set status = 'resolved', resolved_at = now(), resolved_by_staff_id = $2
            where conversation_id = $1 and status = 'open'`,
          [id, staffId],
        );
      }
      await recordAction(tx, ctx, {
        actionType: data.active ? "human_takeover_activated" : "human_takeover_released",
        conversationId: id,
        customerId: current.customerId,
        leadId: current.leadId,
        input: data,
      });
      return mapConversationRow(row!);
    });
  }

  async function assignStaff(conversationId: string, staffId: string, ctx: ActionContext): Promise<Conversation> {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    const sid = parseInput(uuidSchema, staffId, "staff id");
    return db.transaction(async (tx) => {
      const current = await loadConversation(tx, id, true);
      await assertAssignableStaff(tx, sid, ctx);
      const row = await queryOne<ConversationRow>(
        tx,
        `update conversations set assigned_staff_id = $2 where id = $1 returning *`,
        [id, sid],
      );
      await recordAction(tx, ctx, {
        actionType: "conversation_staff_assigned",
        conversationId: id,
        customerId: current.customerId,
        input: { staffId: sid, previousStaffId: current.assignedStaffId },
      });
      return mapConversationRow(row!);
    });
  }

  async function closeConversation(conversationId: string, ctx: ActionContext): Promise<Conversation> {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    return db.transaction(async (tx) => {
      const current = await loadConversation(tx, id, true);
      if (current.status === "closed") return current;
      const row = await queryOne<ConversationRow>(
        tx,
        `update conversations set status = 'closed', closed_at = now() where id = $1 returning *`,
        [id],
      );
      await recordAction(tx, ctx, { actionType: "conversation_closed", conversationId: id, customerId: current.customerId });
      return mapConversationRow(row!);
    });
  }

  return {
    createConversation,
    getConversation,
    findConversationByExternalId,
    getCustomerConversations,
    attachCustomer,
    addMessage,
    getRecentMessages,
    setHumanTakeover,
    assignStaff,
    closeConversation,
  };
}

export type ConversationService = ReturnType<typeof createConversationService>;
