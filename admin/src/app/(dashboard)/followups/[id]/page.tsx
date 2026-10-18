import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { BLOCK_REASONS, DraftCard, PriorityBadge, ProcessingBadge } from "@/components/followups";
import { Badge, buttonClass, Card, DefinitionList, inputClass, LeadScore, Money, PageHeader, StockBadge } from "@/components/ui";
import {
  approveDraftAction,
  cancelSmartFollowupAction,
  completeSmartFollowupAction,
  editDraftAction,
  generateDraftAction,
  rejectDraftAction,
  requestTakeoverAction,
  rescheduleFollowupAction,
} from "@/lib/actions";
import { formatDateTime, humanize, newRequestKey, utcToZonedLocal } from "@/lib/format";
import { orNotFound, pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-up" };

export default async function FollowupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rt, viewer } = await pageContext();
  const d = await orNotFound(rt.followups.detail(viewer, id));
  const f = d.followup;
  const pending = f.status === "pending";
  const live = d.drafts.find((x) => x.status === "pending_review" || x.status === "approved") ?? null;
  const reviewable = live?.status === "pending_review";
  const canDraft = pending && d.outreach && d.eligibility.canDraftAutomatically;
  const editLanguage = live?.language ?? (d.customer.preferredLanguage === "unknown" ? "english" : d.customer.preferredLanguage);

  return (
    <>
      <PageHeader
        title={d.customerName ?? "Website visitor"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {d.purposeLabel}
            {d.outreach ? "" : " (internal reminder)"} <PriorityBadge priority={f.priority} /> <ProcessingBadge state={f.processingState} status={f.status} />
          </span>
        }
        actions={
          <>
            <Link href={`/customers/${f.customerId}`} className={buttonClass.secondary}>Open Customer 360</Link>
            <Link href="/followups" className="self-center text-sm text-gold-dark hover:underline">← Follow-up Center</Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {d.outreach ? (
            <Card title="Message draft">
              <p className="mb-3 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-dark">
                Drafts are never sent from here. Approving one marks it ready for a future, permitted channel.
              </p>
              {live ? <DraftCard draft={live} /> : <p className="text-sm text-muted">No draft yet.</p>}
              {live?.rationale ? <p className="mt-2 text-xs text-muted">Why: {live.rationale}</p> : null}
              {live && (live.validation as { fallback?: boolean }).fallback ? (
                <p className="mt-2 text-xs text-warning">The AI draft did not pass the safety checks, so a safe template was used.</p>
              ) : null}

              {pending ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {reviewable && live ? (
                    <>
                      <ActionForm action={approveDraftAction} hidden={{ draftId: live.id }} submitLabel="Approve draft" testId="approve-draft">
                        <input name="note" maxLength={2000} placeholder="Note (optional)" aria-label="Approval note" className={inputClass} />
                      </ActionForm>
                      <ActionForm action={rejectDraftAction} hidden={{ draftId: live.id }} submitLabel="Reject draft" variant="danger" testId="reject-draft">
                        <input name="note" maxLength={2000} placeholder="Reason (optional)" aria-label="Rejection reason" className={inputClass} />
                      </ActionForm>
                    </>
                  ) : null}
                  <ActionForm
                    action={generateDraftAction}
                    hidden={{ followupId: f.id, requestKey: newRequestKey() }}
                    submitLabel={live ? "Generate a new draft" : "Generate AI draft"}
                    variant="gold"
                    testId="generate-draft"
                  >
                    <p className="text-xs text-muted">
                      {rt.drafter.kind === "ai" ? "Claude writes from verified CRM facts only; every draft is checked by fixed rules." : "Offline mode: a reviewed template is used (not AI)."}
                    </p>
                    {!canDraft ? <p className="text-xs text-danger">Drafting is not allowed right now — see Eligibility.</p> : null}
                  </ActionForm>
                  <ActionForm action={editDraftAction} hidden={{ followupId: f.id, requestKey: newRequestKey() }} submitLabel="Save edited draft" variant="secondary" testId="edit-draft" className="lg:col-span-2">
                    <textarea name="content" rows={4} maxLength={1000} required defaultValue={live?.content ?? ""} aria-label="Draft message" className={inputClass} dir="auto" />
                    <select name="language" defaultValue={editLanguage} aria-label="Draft language" className={`${inputClass} sm:w-48`}>
                      <option value="english">English</option>
                      <option value="roman_urdu">Roman Urdu</option>
                      <option value="urdu">Urdu</option>
                    </select>
                    <p className="text-xs text-muted">Your edit becomes a new version that still needs approval. Unverified prices, discounts, delivery dates or stock claims are refused.</p>
                  </ActionForm>
                </div>
              ) : null}
            </Card>
          ) : (
            <Card title="Internal reminder">
              <p className="text-sm text-ink">{f.note ?? "Staff callback reminder."}</p>
              <p className="mt-2 text-xs text-muted">Internal reminders never produce a customer message.</p>
            </Card>
          )}

          <Card title="Eligibility (checked by fixed rules)">
            {d.eligibility.blockers.length === 0 && d.eligibility.holds.length === 0 ? (
              <p className="text-sm text-emerald-700" data-testid="eligibility">Eligible. Consent recorded, no opt-out, workflow open.</p>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="eligibility">
                {[...d.eligibility.blockers, ...d.eligibility.holds].map((b) => (
                  <li key={b.code} className="text-danger">• {BLOCK_REASONS[b.code] ?? b.message}</li>
                ))}
              </ul>
            )}
            {f.blockedReason && pending ? <p className="mt-2 text-xs text-muted">Processing note: {BLOCK_REASONS[f.blockedReason] ?? f.blockedReason}</p> : null}
            {f.lastErrorCode && pending ? <p className="mt-2 text-xs text-danger">Last processing error: {f.lastErrorCode} (attempt {f.processingAttempts})</p> : null}
          </Card>

          <Card title="Draft history">
            {d.drafts.length === 0 ? (
              <p className="text-sm text-muted">No drafts.</p>
            ) : (
              <ol className="space-y-3" data-testid="draft-history">
                {d.drafts.map((x) => (
                  <li key={x.id}>
                    <DraftCard draft={x} />
                    <p className="mt-1 text-xs text-muted">
                      {formatDateTime(x.createdAt)}
                      {x.model ? ` · ${x.model}` : ""}
                      {x.reviewedAt ? ` · ${humanize(x.status)} ${formatDateTime(x.reviewedAt)}` : ""}
                      {x.reviewNote ? ` — “${x.reviewNote}”` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Activity">
            <ul className="divide-y divide-line text-sm" data-testid="followup-audit">
              {d.audit.map((a, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span>
                    {humanize(a.actionType)} <span className="text-xs text-muted">· {a.actorType === "staff" ? (a.actorName ?? "Staff") : a.actorType === "ai" ? "Zarghoon AI" : "System"}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {a.status !== "succeeded" ? <Badge tone="danger">{humanize(a.status)}</Badge> : null}
                    {formatDateTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Scheduled", `${formatDateTime(f.scheduledFor)}${f.quietHoursAdjusted ? " (moved out of quiet hours)" : ""}`],
                ["Assigned", d.assignedStaffName ?? "Nobody"],
                ["Lead score", <LeadScore key="s" score={d.leadScore?.score} classification={d.leadScore?.classification} />],
                ["Consent", humanize(d.customer.contactConsent)],
                ["Sequence", d.enrollment ? `Step ${f.sequenceStep} of ${d.enrollment.stepDays.length} (days ${d.enrollment.stepDays.join(" / ")}) · ${d.enrollment.status}` : "—"],
                ["Customer's last message", d.latestCustomerMessage ? formatDateTime(d.latestCustomerMessage.at) : "—"],
              ]}
            />
            {f.note ? <p className="mt-3 rounded-lg bg-ivory p-2 text-sm">{f.note}</p> : null}
          </Card>

          <Card title="Interested product">
            {d.product ? (
              <DefinitionList
                items={[
                  ["Piece", `${d.product.name} (${d.product.sku})`],
                  ["Approved price", <Money key="p" amount={d.product.approvedPrice} currency={d.product.currency} />],
                  ["Stock", <StockBadge key="k" status={d.product.stockStatus} quantity={d.product.stockQuantity} />],
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No product interest recorded.</p>
            )}
          </Card>

          {pending ? (
            <Card title="Manage">
              <div className="space-y-4">
                <ActionForm action={rescheduleFollowupAction} hidden={{ followupId: f.id }} submitLabel="Reschedule" variant="secondary" testId="reschedule">
                  <input type="datetime-local" name="scheduledFor" required defaultValue={utcToZonedLocal(f.scheduledFor)} aria-label="New time" className={inputClass} />
                  <p className="text-xs text-muted">Re-checks eligibility; existing drafts are withdrawn and re-prepared when due.</p>
                </ActionForm>
                <ActionForm action={completeSmartFollowupAction} hidden={{ followupId: f.id }} submitLabel="Mark completed" variant="secondary" testId="complete-followup">
                  <input name="note" maxLength={2000} placeholder="Outcome (e.g. called the customer)" aria-label="Outcome" className={inputClass} />
                </ActionForm>
                <ActionForm action={cancelSmartFollowupAction} hidden={{ followupId: f.id }} submitLabel="Cancel follow-up" variant="danger" confirm="Cancel this follow-up?" testId="cancel-followup">
                  <input name="note" maxLength={2000} placeholder="Reason (optional)" aria-label="Cancel reason" className={inputClass} />
                </ActionForm>
                {!d.humanTakeover ? (
                  <ActionForm action={requestTakeoverAction} hidden={{ customerId: f.customerId }} submitLabel="Request human takeover" variant="secondary" testId="request-takeover">
                    <input name="note" maxLength={2000} placeholder="Why (optional)" aria-label="Takeover note" className={inputClass} />
                  </ActionForm>
                ) : (
                  <p className="text-sm text-danger">A person has taken over this customer&rsquo;s conversation.</p>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
