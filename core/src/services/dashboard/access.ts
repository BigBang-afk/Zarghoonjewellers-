import { ForbiddenActionError } from "../../lib/errors.js";
import { APPROVER_ROLES, type StaffRole, type StaffSummary } from "../staffRules.js";

/**
 * Who may see what in the management dashboard. Enforced on the server, in
 * every query and action — never by hiding buttons.
 *
 *  - owner, admin, manager: the whole business.
 *  - sales, support: only customers they are responsible for — an assigned
 *    lead, conversation, follow-up or handoff — plus the queue of open,
 *    unassigned handoffs (so someone can take them).
 *
 * Records outside a viewer's scope are reported as "not found", so their
 * existence is not revealed.
 */

export const FULL_ACCESS_ROLES: readonly StaffRole[] = ["owner", "admin", "manager"];

export type Viewer = StaffSummary;

export const can = {
  viewAllCustomers: (v: Viewer) => FULL_ACCESS_ROLES.includes(v.role),
  /** Assign leads/follow-ups to colleagues (others may only take work themselves). */
  assignOthers: (v: Viewer) => FULL_ACCESS_ROLES.includes(v.role),
  decideApprovals: (v: Viewer) => APPROVER_ROLES.includes(v.role),
  viewAudit: (v: Viewer) => FULL_ACCESS_ROLES.includes(v.role),
  viewSyncRecords: (v: Viewer) => APPROVER_ROLES.includes(v.role),
  manageStaffSignIn: (v: Viewer) => v.role === "owner" || v.role === "admin",
  resetDemo: (v: Viewer) => v.role === "owner" || v.role === "admin",
};

export function requireCapability(v: Viewer, allowed: boolean, action: string): void {
  if (!v.isActive || !allowed) {
    throw new ForbiddenActionError(`Your role (${v.role}) may not ${action}`, { action, role: v.role });
  }
}

/** The staff id to scope queries by, or null for full access. */
export const scopeStaffId = (v: Viewer): string | null => (can.viewAllCustomers(v) ? null : v.id);

/**
 * SQL predicate: customer `$col` is visible to the viewer whose scope id is
 * parameter `$param` (null = everyone).
 */
export function customerScopeSql(col: string, param: string): string {
  return `(${param}::uuid is null or exists (select 1 from leads zl where zl.customer_id = ${col} and zl.assigned_staff_id = ${param})
    or exists (select 1 from conversations zc where zc.customer_id = ${col} and zc.assigned_staff_id = ${param})
    or exists (select 1 from followups zf where zf.customer_id = ${col} and zf.assigned_staff_id = ${param})
    or exists (select 1 from handoffs zh where zh.customer_id = ${col} and zh.assigned_staff_id = ${param}))`;
}
