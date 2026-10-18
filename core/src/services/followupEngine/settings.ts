import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { DEFAULT_BUSINESS_TIMEZONE, isValidTimeZone, parseClock, type QuietHours } from "../../lib/businessTime.js";
import { parseInput } from "../../lib/validation.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { requireStaffActor } from "../staffRules.js";

export interface FollowupSettings {
  timezone: string;
  quietHours: QuietHours;
  defaultSequenceDays: number[];
  maxProcessingAttempts: number;
}

export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = {
  timezone: DEFAULT_BUSINESS_TIMEZONE,
  quietHours: { enabled: true, start: "21:00", end: "10:00", timezone: DEFAULT_BUSINESS_TIMEZONE },
  defaultSequenceDays: [1, 3, 7],
  maxProcessingAttempts: 3,
};

interface SettingsRow {
  timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  default_sequence_days: number[];
  max_processing_attempts: number;
}

export async function getFollowupSettings(db: Db): Promise<FollowupSettings> {
  const r = await queryOne<SettingsRow>(
    db,
    `select timezone, quiet_hours_enabled, quiet_hours_start::text as quiet_hours_start, quiet_hours_end::text as quiet_hours_end,
            default_sequence_days, max_processing_attempts from followup_settings where id`,
  );
  if (!r) return DEFAULT_FOLLOWUP_SETTINGS;
  return {
    timezone: r.timezone,
    quietHours: { enabled: r.quiet_hours_enabled, start: r.quiet_hours_start.slice(0, 5), end: r.quiet_hours_end.slice(0, 5), timezone: r.timezone },
    defaultSequenceDays: r.default_sequence_days.map(Number),
    maxProcessingAttempts: r.max_processing_attempts,
  };
}

const clock = z.string().regex(/^\d{2}:\d{2}$/).refine((v) => {
  try {
    parseClock(v);
    return true;
  } catch {
    return false;
  }
}, "Use HH:MM");

export const settingsUpdateSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: clock.optional(),
    quietHoursEnd: clock.optional(),
    defaultSequenceDays: z
      .array(z.number().int().min(1).max(60))
      .min(1)
      .max(5)
      .refine((d) => d.every((v, i) => i === 0 || v > d[i - 1]!), "Days must increase")
      .optional(),
    maxProcessingAttempts: z.number().int().min(1).max(10).optional(),
  })
  .strict();

/** Owner/admin only. */
export async function updateFollowupSettings(db: Db, input: unknown, ctx: ActionContext): Promise<FollowupSettings> {
  const data = parseInput(settingsUpdateSchema, input, "follow-up settings");
  return db.transaction(async (tx) => {
    const staff = await requireStaffActor(tx, ctx, "change follow-up settings", ["owner", "admin"]);
    const current = await getFollowupSettings(tx);
    const next = {
      timezone: data.timezone ?? current.timezone,
      enabled: data.quietHoursEnabled ?? current.quietHours.enabled,
      start: data.quietHoursStart ?? current.quietHours.start,
      end: data.quietHoursEnd ?? current.quietHours.end,
      days: data.defaultSequenceDays ?? current.defaultSequenceDays,
      attempts: data.maxProcessingAttempts ?? current.maxProcessingAttempts,
    };
    await tx.query(
      `insert into followup_settings (id, timezone, quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
                                      default_sequence_days, max_processing_attempts, updated_by_staff_id, updated_at)
       values (true, $1, $2, $3::time, $4::time, $5::smallint[], $6, $7, now())
       on conflict (id) do update set timezone = excluded.timezone, quiet_hours_enabled = excluded.quiet_hours_enabled,
         quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end,
         default_sequence_days = excluded.default_sequence_days, max_processing_attempts = excluded.max_processing_attempts,
         updated_by_staff_id = excluded.updated_by_staff_id, updated_at = now()`,
      [next.timezone, next.enabled, next.start, next.end, next.days, next.attempts, staff.id],
    );
    await recordAction(tx, ctx, { actionType: "followup_settings_updated", input: data });
    return getFollowupSettings(tx);
  });
}
