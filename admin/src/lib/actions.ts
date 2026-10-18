"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, toPublicError, type StaffSummary, type DashboardRuntime } from "@zarghoon/core/dashboard";
import { zonedLocalToUtc } from "./format";
import { allowDraftGeneration, allowLogin, allowStaffAction } from "./rateLimit";
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

class DraftRateLimitError extends Error {
  constructor(seconds: number) {
    super(`Too many draft requests. Try again in ${seconds}s.`);
  }
}

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
    if (error instanceof DraftRateLimitError) return { ok: false, message: null, error: error.message };
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

// --- AI Follow-up Center (Step 9). Nothing here sends a message. --------------------------

const bool = (form: FormData, name: string) => form.get(name) === "on" || form.get(name) === "true";

export async function scheduleSmartFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const when = field(form, "scheduledFor");
    const common = {
      customerId: field(form, "customerId"),
      purpose: field(form, "purpose"),
      productId: field(form, "productId"),
      assignedStaffId: field(form, "assignedStaffId"),
      idempotencyKey: field(form, "requestKey"),
    };
    if (bool(form, "sequence")) {
      await rt.actions.enrollSequence(viewer, common);
      return "Sequence started (Day 1 / 3 / 7). Only the first step is scheduled now. Nothing is sent automatically.";
    }
    const result = await rt.actions.scheduleSmartFollowup(viewer, {
      ...common,
      leadId: field(form, "leadId"),
      priority: field(form, "priority"),
      note: field(form, "note"),
      ...(when ? { scheduledFor: zonedLocalToUtc(when)?.toISOString() ?? "invalid" } : { delayDays: Number(field(form, "delayDays") ?? 1) }),
    });
    if (!result.created) return "This follow-up was already scheduled.";
    return result.followup.quietHoursAdjusted
      ? "Follow-up scheduled — moved out of quiet hours. Nothing is sent automatically."
      : "Follow-up scheduled. Nothing is sent automatically.";
  });
}

export async function generateDraftAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const limit = allowDraftGeneration(viewer.id);
    if (!limit.allowed) throw new DraftRateLimitError(limit.retryAfterSeconds);
    const draft = await rt.actions.generateDraft(viewer, field(form, "followupId"), field(form, "requestKey"));
    return draft.authorType === "ai" ? "Draft written by Claude — please review it." : "Draft prepared from a safe template — please review it.";
  });
}

export async function editDraftAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.editDraft(viewer, {
      followupId: field(form, "followupId"),
      content: field(form, "content") ?? "",
      language: field(form, "language"),
      requestKey: field(form, "requestKey"),
    });
    return "Your edited draft is saved and waiting for approval.";
  });
}

export async function approveDraftAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.approveDraft(viewer, field(form, "draftId"), field(form, "note"));
    return "Approved for a future permitted channel. It has not been sent.";
  });
}

export async function rejectDraftAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.rejectDraft(viewer, field(form, "draftId"), field(form, "note"));
    return "Draft rejected.";
  });
}

export async function rescheduleFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const when = zonedLocalToUtc(field(form, "scheduledFor") ?? "");
    const f = await rt.actions.rescheduleFollowup(viewer, field(form, "followupId"), when?.toISOString() ?? "invalid");
    return f.quietHoursAdjusted ? "Rescheduled — moved out of quiet hours." : "Rescheduled.";
  });
}

export async function cancelSmartFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.cancelSmartFollowup(viewer, field(form, "followupId"), field(form, "note"));
    return "Follow-up cancelled.";
  });
}

export async function completeSmartFollowupAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.completeSmartFollowup(viewer, field(form, "followupId"), field(form, "note"));
    return "Follow-up completed.";
  });
}

export async function requestTakeoverAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    await rt.actions.requestHumanTakeover(viewer, field(form, "customerId"), field(form, "note"));
    return "Human takeover requested. The AI will not reply in this conversation.";
  });
}

export async function setConsentAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const r = await rt.actions.setContactConsent(viewer, field(form, "customerId"), field(form, "consent"), field(form, "source") ?? "");
    return r.consent === "denied" ? `Consent recorded as declined. ${r.cancelledFollowups} pending follow-up(s) cancelled.` : "Consent updated.";
  });
}

export async function setIdentityReviewAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const r = await rt.actions.setIdentityReview(viewer, field(form, "customerId"), bool(form, "required"));
    return r.identityReviewRequired ? "Identity flagged for review — outreach is paused." : "Identity review cleared.";
  });
}

export async function runWorkerAction(_prev: ActionState) {
  return run(async (rt, viewer) => {
    const s = await rt.actions.runFollowupWorker(viewer);
    return `Processed ${s.claimed} due follow-up(s): ${s.drafted} drafted, ${s.reminders} reminder(s), ${s.held} on hold, ${s.cancelled} cancelled, ${s.failed} failed. Nothing was sent.`;
  });
}

export async function markNotificationsReadAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const ids = form.getAll("notificationId").filter((v): v is string => typeof v === "string");
    const n = await rt.followups.markRead(viewer, ids);
    return `${n} notification(s) marked as read.`;
  });
}

export async function updateFollowupSettingsAction(_prev: ActionState, form: FormData) {
  return run(async (rt, viewer) => {
    const days = (field(form, "defaultSequenceDays") ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
    await rt.actions.updateFollowupSettings(viewer, {
      timezone: field(form, "timezone"),
      quietHoursEnabled: bool(form, "quietHoursEnabled"),
      quietHoursStart: field(form, "quietHoursStart"),
      quietHoursEnd: field(form, "quietHoursEnd"),
      defaultSequenceDays: days.length ? days : undefined,
      maxProcessingAttempts: field(form, "maxProcessingAttempts") ? Number(field(form, "maxProcessingAttempts")) : undefined,
    });
    return "Follow-up settings saved.";
  });
}
