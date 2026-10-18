"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, toPublicError, type StaffSummary, type DashboardRuntime } from "@zarghoon/core/dashboard";
import { zonedLocalToUtc } from "./format";
import { allowLogin, allowStaffAction } from "./rateLimit";
import { getRuntime, resetDemoRuntime } from "./runtime";
import { clearSessionCookie, clientAddress, getSession, SESSION_COOKIE, setSessionCookie } from "./session";

/**
 * Server Actions. Each is a public POST endpoint, so each one:
 *  - resolves the staff session from the database (never trusts the form),
 *  - applies a per-staff rate limit,
 *  - calls the core dashboard actions, which re-check role and scope and
 *    then use the existing CRM services (business rules + audit log).
 * Hidden form fields (ids) are untrusted input and are validated in core.
 */

export interface ActionState {
  ok: boolean;
  message: string | null;
  error: string | null;
}

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};

async function run(work: (rt: DashboardRuntime, viewer: StaffSummary) => Promise<string>): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { ok: false, message: null, error: "Your session has ended. Please sign in again." };
  const limit = allowStaffAction(session.staff.id);
  if (!limit.allowed) return { ok: false, message: null, error: `Too many actions. Try again in ${limit.retryAfterSeconds}s.` };
  try {
    const message = await work(await getRuntime(), session.staff);
    revalidatePath("/", "layout");
    return { ok: true, message, error: null };
  } catch (error) {
    const pub = toPublicError(error);
    if (pub.code === "INTERNAL_ERROR") {
      console.error(JSON.stringify({ level: "error", message: "dashboard action failed", name: (error as Error)?.name }));
    }
    const issues = (pub.details?.issues as { path: string; message: string }[] | undefined)?.map((i) => i.message);
    return { ok: false, message: null, error: issues?.length ? `${pub.message}: ${issues.join("; ")}` : pub.message };
  }
}

// --- Sign-in ------------------------------------------------------------------------------------

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const username = field(form, "username") ?? "";
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  const limit = allowLogin(await clientAddress(), username);
  if (!limit.allowed) return { ok: false, message: null, error: "Too many sign-in attempts. Please wait a minute and try again." };
  const rt = await getRuntime();
  const result = await rt.auth.login({ username, password, userAgent: (await headers()).get("user-agent") });
  if (!result.ok) {
    return {
      ok: false,
      message: null,
      error: result.reason === "locked" ? "This account is temporarily locked after several failed attempts. Try again in 15 minutes." : "Incorrect username or password.",
    };
  }
  await setSessionCookie(result.token, result.expiresAt, rt.config.secureCookies);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    await (await getRuntime()).auth.logout(token);
  } finally {
    await clearSessionCookie();
  }
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { ok: false, message: null, error: "Your session has ended. Please sign in again." };
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { ok: false, message: null, error: "The new passwords do not match." };
  try {
    await (await getRuntime()).auth.changeOwnPassword(session, current, next);
  } catch (error) {
    return { ok: false, message: null, error: toPublicError(error).message };
  }
  await clearSessionCookie();
  redirect("/login?changed=1");
}

// --- Leads ----------------------------------------------------------------------------------------

export async function addLeadNoteAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.addLeadNote(viewer, field(form, "leadId"), field(form, "note") ?? "");
    return "Note added.";
  });
}

export async function assignLeadAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.assignLead(viewer, field(form, "leadId"), field(form, "staffId"));
    return "Lead assigned.";
  });
}

export async function markLeadWonAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.markLeadWon(viewer, field(form, "leadId"), field(form, "note"));
    return "Lead marked as won.";
  });
}

export async function markLeadLostAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.markLeadLost(viewer, field(form, "leadId"), field(form, "reason") ?? "");
    return "Lead marked as lost.";
  });
}

// --- Follow-ups -------------------------------------------------------------------------------------

export async function scheduleFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const when = zonedLocalToUtc(field(form, "scheduledFor") ?? "");
    await rt.actions.scheduleFollowup(viewer, {
      customerId: field(form, "customerId"),
      leadId: field(form, "leadId"),
      scheduledFor: when?.toISOString() ?? "invalid",
      followupType: field(form, "followupType"),
      channel: field(form, "channel"),
      note: field(form, "note"),
      assignedStaffId: field(form, "assignedStaffId"),
    });
    return "Follow-up scheduled. Nothing is sent automatically.";
  });
}

export async function completeFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.completeFollowup(viewer, field(form, "followupId"), field(form, "note"));
    return "Follow-up completed.";
  });
}

export async function cancelFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.cancelFollowup(viewer, field(form, "followupId"), field(form, "note"));
    return "Follow-up cancelled.";
  });
}

// --- Handoffs ----------------------------------------------------------------------------------------

export async function takeOverHandoffAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.takeOverHandoff(viewer, field(form, "handoffId"));
    return "You have taken over this conversation. The AI will not reply while takeover is active.";
  });
}

export async function resolveHandoffAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const release = form.get("releaseTakeover") === "on";
    await rt.actions.resolveHandoff(viewer, field(form, "handoffId"), { releaseTakeover: release, note: field(form, "note") });
    return release ? "Handoff resolved; the AI may reply again." : "Handoff resolved; human takeover remains active.";
  });
}

// --- Approvals ------------------------------------------------------------------------------------------

export async function decideApprovalAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const decision = field(form, "decision");
    await rt.actions.decideApproval(viewer, field(form, "approvalId"), decision, field(form, "note"));
    return decision === "approved" ? "Approved." : "Rejected.";
  });
}

// --- Demo -----------------------------------------------------------------------------------------------

export async function resetDemoAction(_prev: ActionState): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { ok: false, message: null, error: "Your session has ended. Please sign in again." };
  const rt = await getRuntime();
  if (rt.mode !== "demo") return { ok: false, message: null, error: "Reset is only available in demo mode." };
  if (!can.resetDemo(session.staff)) return { ok: false, message: null, error: "Only the owner or an admin can reset demo data." };
  await resetDemoRuntime();
  await clearSessionCookie();
  redirect("/login?reset=1");
}
