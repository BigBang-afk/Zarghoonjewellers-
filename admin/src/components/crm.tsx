import { FOLLOWUP_TYPES } from "@zarghoon/core/dashboard";
import { scheduleFollowupAction } from "@/lib/actions";
import { defaultFollowupLocal, humanize } from "@/lib/format";
import { ActionForm } from "./ActionForm";
import { inputClass } from "./ui";

export { MessageThread, ScoreBreakdown } from "./crmDisplay";

export function ScheduleFollowupForm({
  customerId,
  leadId,
  staff,
  canAssignOthers,
  viewerId,
  defaultAssigneeId,
  disabledReason,
}: {
  customerId: string;
  leadId?: string | null;
  staff: { id: string; fullName: string; isAvailable: boolean }[];
  canAssignOthers: boolean;
  viewerId: string;
  /** Pre-selected assignee for managers (e.g. the lead owner); defaults to the viewer. */
  defaultAssigneeId?: string | null;
  disabledReason?: string | null;
}) {
  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;
  const tomorrow = defaultFollowupLocal();
  return (
    <ActionForm
      action={scheduleFollowupAction}
      hidden={{ customerId, ...(leadId ? { leadId } : {}) }}
      submitLabel="Schedule follow-up"
      testId="schedule-followup"
    >
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-muted">
          When (Pakistan time)
          <input type="datetime-local" name="scheduledFor" required defaultValue={tomorrow} className={inputClass} />
        </label>
        <label className="text-xs text-muted">
          Type
          <select name="followupType" defaultValue="sales" className={inputClass}>
            {FOLLOWUP_TYPES.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </select>
        </label>
        {canAssignOthers ? (
          <label className="text-xs text-muted">
            Assign to
            <select name="assignedStaffId" defaultValue={defaultAssigneeId ?? viewerId} className={inputClass}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                  {s.isAvailable ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs text-muted">
          Note for staff
          <input name="note" maxLength={2000} placeholder="What to follow up about" className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-muted">This records a task for staff. No WhatsApp, SMS or email is sent.</p>
    </ActionForm>
  );
}
