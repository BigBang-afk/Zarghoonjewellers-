import { FOLLOWUP_PRIORITIES, PURPOSE_META, type FollowupPurpose } from "@zarghoon/core/dashboard";
import { scheduleSmartFollowupAction, setConsentAction } from "@/lib/actions";
import { defaultFollowupLocal, humanize } from "@/lib/format";
import { ActionForm } from "./ActionForm";
import { inputClass } from "./ui";

export { BLOCK_REASONS, DraftCard, PriorityBadge, ProcessingBadge } from "./followupDisplay";

const PURPOSE_OPTIONS = Object.entries(PURPOSE_META) as [FollowupPurpose, (typeof PURPOSE_META)[FollowupPurpose]][];

/** Schedule an engine follow-up (or an opt-in Day 1/3/7 sequence). */
export function SmartFollowupForm({
  customerId,
  leadId,
  productId,
  defaultPurpose = "product_interest",
  staff,
  canAssignOthers,
  viewerId,
  requestKey,
  disabledReason,
}: {
  customerId: string;
  leadId?: string | null;
  productId?: string | null;
  defaultPurpose?: FollowupPurpose;
  staff: { id: string; fullName: string; isAvailable: boolean }[];
  canAssignOthers: boolean;
  viewerId: string;
  requestKey: string;
  disabledReason?: string | null;
}) {
  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;
  return (
    <ActionForm
      action={scheduleSmartFollowupAction}
      hidden={{ customerId, requestKey, ...(leadId ? { leadId } : {}), ...(productId ? { productId } : {}) }}
      submitLabel="Schedule follow-up"
      testId="schedule-followup"
    >
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-muted">
          Follow-up type
          <select name="purpose" defaultValue={defaultPurpose} className={inputClass} aria-label="Follow-up type">
            {PURPOSE_OPTIONS.map(([p, m]) => (
              <option key={p} value={p}>
                {m.label}
                {m.outreach ? "" : " (internal)"}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Priority
            <select name="priority" defaultValue="normal" className={inputClass} aria-label="Priority">
              {FOLLOWUP_PRIORITIES.map((p) => (
                <option key={p} value={p}>{humanize(p)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            When (Pakistan time)
            <input type="datetime-local" name="scheduledFor" defaultValue={defaultFollowupLocal()} className={inputClass} aria-label="When" />
          </label>
        </div>
        {canAssignOthers ? (
          <label className="text-xs text-muted">
            Assign to
            <select name="assignedStaffId" defaultValue={viewerId} className={inputClass} aria-label="Assign to">
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
          <input name="note" maxLength={2000} placeholder="What to follow up about" className={inputClass} aria-label="Note for staff" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sequence" /> Start a Day 1 / 3 / 7 sequence instead (one step at a time)
        </label>
      </div>
      <p className="text-xs text-muted">
        Only allowed when the customer has given consent and has not opted out. Customer messages are moved out of quiet hours. Nothing is
        sent — drafts wait for staff approval.
      </p>
    </ActionForm>
  );
}

export function ConsentForm({ customerId, consent }: { customerId: string; consent: string }) {
  return (
    <ActionForm action={setConsentAction} hidden={{ customerId }} submitLabel="Save consent" variant="secondary" testId="consent-form">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Messaging consent
          <select name="consent" defaultValue={consent} className={inputClass} aria-label="Messaging consent">
            <option value="unknown">Unknown</option>
            <option value="granted">Granted</option>
            <option value="denied">Declined</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          How it was given
          <input name="source" required minLength={3} maxLength={200} placeholder="e.g. Agreed in store on 18 Oct" className={inputClass} aria-label="Consent source" />
        </label>
      </div>
    </ActionForm>
  );
}
