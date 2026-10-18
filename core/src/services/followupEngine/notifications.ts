import type { Db } from "../../database/db.js";

/**
 * Internal dashboard notifications. Idempotent by `dedupeKey`: the same event
 * never notifies twice. Nothing is sent outside the dashboard.
 */

export type NotificationKind = "high_priority_followup" | "overdue_followup" | "human_attention" | "draft_awaiting_review" | "processing_failed";

export interface NewNotification {
  kind: NotificationKind;
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string | null;
  customerId?: string | null;
  followupId?: string | null;
  handoffId?: string | null;
  /** The responsible staff member; null = owner/admin/manager queue. */
  audienceStaffId?: string | null;
  dedupeKey: string;
}

export async function notifyTx(tx: Db, n: NewNotification): Promise<boolean> {
  const rows = await tx.query(
    `insert into notifications (kind, severity, title, body, customer_id, followup_id, handoff_id, audience_staff_id, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (dedupe_key) do nothing returning id`,
    [n.kind, n.severity, n.title.slice(0, 200), n.body?.slice(0, 1000) ?? null, n.customerId ?? null, n.followupId ?? null, n.handoffId ?? null, n.audienceStaffId ?? null, n.dedupeKey],
  );
  return rows.length > 0;
}

/** Marks notifications about a follow-up as resolved (e.g. it was handled). */
export async function resolveFollowupNotificationsTx(tx: Db, followupId: string, kinds?: NotificationKind[]): Promise<void> {
  await tx.query(
    `update notifications set resolved_at = now()
      where followup_id = $1 and resolved_at is null and ($2::text[] is null or kind = any($2))`,
    [followupId, kinds ?? null],
  );
}
