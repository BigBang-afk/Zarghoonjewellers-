import type { Metadata } from "next";
import Link from "next/link";
import { can, CENTER_TABS, type CenterTab } from "@zarghoon/core/dashboard";
import { ActionForm } from "@/components/ActionForm";
import { BLOCK_REASONS, DraftCard, PriorityBadge, ProcessingBadge } from "@/components/followups";
import { Badge, buttonClass, Card, EmptyState, hrefWith, inputClass, LeadScore, PageHeader, Pagination, Tabs } from "@/components/ui";
import { cancelSmartFollowupAction, completeSmartFollowupAction, runWorkerAction } from "@/lib/actions";
import { formatDateTime, formatRelative } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Follow-up Center" };

const TAB_LABELS: Record<CenterTab, string> = {
  due_today: "Due today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  review: "Drafts to review",
  approved: "Approved (not sent)",
  attention: "Needs attention",
  completed: "Completed",
  cancelled: "Cancelled",
  history: "History",
};
/** Step 8 links (?tab=today) keep working. */
const ALIASES: Record<string, CenterTab> = { today: "due_today" };

export default async function FollowupCenterPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const tab = ALIASES[params.tab ?? ""] ?? params.tab ?? "due_today";
  const r = await rt.followups.list(viewer, tab, params.page);
  const recommendations = r.tab === "due_today" ? (await rt.followups.recommendations(viewer, 6)).filter((x) => x.recommended) : [];
  const pending = ["due_today", "overdue", "upcoming", "review", "approved", "attention"].includes(r.tab);

  return (
    <>
      <PageHeader
        title="AI Follow-up Center"
        description="Follow-ups prepared from stored CRM data. Drafts are reviewed by staff and approved for a future channel — nothing is sent from here."
        actions={
          <>
            <Badge tone={rt.drafter.kind === "ai" ? "dark" : "neutral"}>{rt.drafter.kind === "ai" ? `Drafts by Claude (${rt.drafter.model})` : "Offline templates — not AI"}</Badge>
            <Link href="/followups/analytics" className={buttonClass.secondary}>Analytics</Link>
            {can.assignOthers(viewer) ? <ActionForm action={runWorkerAction} submitLabel="Process due follow-ups now" variant="secondary" testId="run-worker" /> : null}
          </>
        }
      />

      <Tabs current={r.tab} items={CENTER_TABS.map((k) => ({ key: k, label: TAB_LABELS[k], href: `/followups?tab=${k}`, count: r.counts[k] }))} />

      {recommendations.length ? (
        <Card title="Suggested follow-ups" className="mb-6">
          <ul className="divide-y divide-line" data-testid="recommendations">
            {recommendations.map((rec) => (
              <li key={rec.customerId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <Link href={`/customers/${rec.customerId}`} className="font-medium text-emerald-800 hover:underline">{rec.customerName ?? "Website visitor"}</Link>
                  <span className="ml-2"><PriorityBadge priority={rec.priority} /></span>
                  <p className="text-xs text-muted">{rec.reason} · suggested: {rec.suggestedFollowupType?.replace(/_/g, " ")}</p>
                </div>
                <Link href={`/customers/${rec.customerId}#schedule`} className="text-sm text-gold-dark hover:underline">Review &amp; schedule →</Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Suggestions come from fixed rules over stored data. Nothing is scheduled until a staff member does it.</p>
        </Card>
      ) : null}

      {r.rows.length === 0 ? (
        <EmptyState title={`Nothing in “${TAB_LABELS[r.tab]}”`}>
          {r.tab === "overdue" ? "Everything is on schedule." : "Schedule follow-ups from a customer's page, or review the suggestions above."}
        </EmptyState>
      ) : (
        <ul className="space-y-3" data-testid="followup-list">
          {r.rows.map((f) => (
            <li key={f.id} className={`rounded-xl border bg-surface p-4 ${f.priority === "urgent" ? "border-red-200" : "border-line"}`} data-testid="followup-item">
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/followups/${f.id}`} className="font-medium text-emerald-800 hover:underline" data-testid="followup-link">
                      {f.customerName ?? "Website visitor"}
                    </Link>
                    <Badge>{f.purposeLabel}{f.outreach ? "" : " · internal"}</Badge>
                    <PriorityBadge priority={f.priority} />
                    <ProcessingBadge state={f.processingState} status={f.status} />
                    {f.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
                    {f.outreach && f.contactConsent !== "granted" && f.status === "pending" ? <Badge tone="warning">No consent</Badge> : null}
                    {f.sequenceStep ? <Badge>Sequence step {f.sequenceStep}</Badge> : null}
                  </p>
                  <p className="text-sm text-ink">
                    {formatDateTime(f.scheduledFor)} <span className="text-muted">({formatRelative(f.scheduledFor)})</span>
                    {f.quietHoursAdjusted ? <span className="ml-2 text-xs text-muted">moved out of quiet hours</span> : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>{f.productName ? `${f.productName} (${f.productSku})` : "No product recorded"}</span>
                    <LeadScore score={f.leadScore} classification={f.leadClassification} />
                    <span>Assigned: {f.assignedStaffName ?? "nobody"}</span>
                  </p>
                  {f.blockedReason && f.status === "pending" ? <p className="text-xs text-danger">{BLOCK_REASONS[f.blockedReason] ?? f.blockedReason}</p> : null}
                  {f.lastErrorCode && f.status === "pending" ? <p className="text-xs text-danger">Last error: {f.lastErrorCode}</p> : null}
                  {f.outcomeNote && f.status !== "pending" ? <p className="text-sm text-muted">Outcome: {f.outcomeNote}</p> : null}
                  {f.draft ? <DraftCard draft={f.draft} compact /> : null}
                </div>
                {pending ? (
                  <div className="flex flex-col gap-2 sm:flex-row lg:w-[26rem] lg:flex-col">
                    <Link href={`/followups/${f.id}`} className={`${buttonClass.primary} justify-center`}>Open</Link>
                    <ActionForm action={completeSmartFollowupAction} hidden={{ followupId: f.id }} submitLabel="Mark completed" variant="secondary" testId="complete-followup">
                      <input name="note" maxLength={2000} placeholder="Outcome (optional)" aria-label="Outcome" className={inputClass} />
                    </ActionForm>
                    <ActionForm action={cancelSmartFollowupAction} hidden={{ followupId: f.id }} submitLabel="Cancel" variant="danger" confirm="Cancel this follow-up?" testId="cancel-followup">
                      <input name="note" maxLength={2000} placeholder="Reason (optional)" aria-label="Cancel reason" className={inputClass} />
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={r.page} pageSize={r.pageSize} total={r.total} href={(p) => hrefWith("/followups", { ...params, tab: r.tab }, { page: String(p) })} />
    </>
  );
}
