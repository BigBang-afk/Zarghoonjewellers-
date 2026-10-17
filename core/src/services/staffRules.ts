import { queryOne, type Db } from "../database/db.js";
import { ForbiddenActionError, StaffNotFoundError, StaffUnavailableError } from "../lib/errors.js";
import type { ActionContext } from "../types/context.js";

export const STAFF_ROLES = ["owner", "manager", "sales", "support", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles allowed to decide approvals and other sensitive actions. */
export const APPROVER_ROLES: readonly StaffRole[] = ["owner", "manager", "admin"];

export interface StaffSummary {
  id: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  isAvailable: boolean;
}

interface StaffRow {
  id: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  is_available: boolean;
}

export function mapStaffRow(r: StaffRow): StaffSummary {
  return { id: r.id, fullName: r.full_name, role: r.role, isActive: r.is_active, isAvailable: r.is_available };
}

export async function findStaff(db: Db, staffId: string): Promise<StaffSummary | null> {
  const row = await queryOne<StaffRow>(
    db,
    `select id, full_name, role, is_active, is_available from staff where id = $1`,
    [staffId],
  );
  return row ? mapStaffRow(row) : null;
}

/**
 * Validates a staff member before assigning them to a lead, conversation,
 * follow-up or handoff.
 *
 * Rule: automated actors (AI/system) may only assign staff who are active
 * AND marked available. A staff member assigning work manually may choose any
 * active colleague — they are taking responsibility for that choice.
 */
export async function assertAssignableStaff(db: Db, staffId: string, ctx: ActionContext): Promise<StaffSummary> {
  const staff = await findStaff(db, staffId);
  if (!staff) throw new StaffNotFoundError({ id: staffId });
  if (!staff.isActive) throw new StaffUnavailableError(staffId, "inactive");
  if (ctx.actor.type !== "staff" && !staff.isAvailable) throw new StaffUnavailableError(staffId, "unavailable");
  return staff;
}

/** Requires the actor to be an active staff member, optionally with one of the given roles. */
export async function requireStaffActor(
  db: Db,
  ctx: ActionContext,
  action: string,
  roles?: readonly StaffRole[],
): Promise<StaffSummary> {
  if (ctx.actor.type !== "staff") {
    throw new ForbiddenActionError(`Only staff may ${action}`, { action, actorType: ctx.actor.type });
  }
  const staff = await findStaff(db, ctx.actor.staffId);
  if (!staff || !staff.isActive) {
    throw new ForbiddenActionError(`Only active staff may ${action}`, { action });
  }
  if (roles && !roles.includes(staff.role)) {
    throw new ForbiddenActionError(`Staff role "${staff.role}" may not ${action}`, { action, role: staff.role });
  }
  return staff;
}
