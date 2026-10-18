import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Badge, EmptyState, hrefWith, inputClass, LeadStatusBadge, PageHeader, Pagination, Tabs } from "@/components/ui";
import { cancelFollowupAction, completeFollowupAction } from "@/lib/actions";
import { formatDateTime, formatRelative, humanize } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const r = await rt.dashboard.listFollowups(viewer, params.tab ?? "today", Number(params.page ?? 1));
  const pending = r.bucket === "today" || r.bucket === "overdue" || r.bucket === "upcoming";

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Tasks for staff. Nothing is sent automatically — no WhatsApp, SMS or email. Customers who opted out, and closed leads, cannot get new sales follow-ups."
      />
      <Tabs current={r.bucket} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/followups?tab=${t.key}`, count: r.counts[t.key] }))} />
      {r.rows.length === 0 ? (
        <EmptyState title={`No ${r.bucket} follow-ups`}>
          {r.bucket === "overdue" ? "Everything is on schedule." : "Schedule follow-ups from a customer's or lead's page."}
        </EmptyState>
      ) : (
        <ul className="space-y-3" data-testid="followup-list">
          {r.rows.map((f) => (
            <li key={f.id} className="rounded-xl border border-line bg-surface p-4" data-testid="followup-item">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/customers/${f.customerId}`} className="font-medium text-emerald-800 hover:underline">
                      {f.customerName ?? "Website visitor"}
                    </Link>
                    <Badge>{humanize(f.followupType)}</Badge>
                    {f.leadStatus ? <LeadStatusBadge status={f.leadStatus} /> : null}
                    {f.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
                    {r.bucket === "overdue" ? <Badge tone="danger">Overdue</Badge> : null}
                  </p>
                  <p className="text-sm text-ink">
                    {formatDateTime(f.scheduledFor)} <span className="text-muted">({formatRelative(f.scheduledFor)})</span>
                  </p>
                  {f.note ? <p className="text-sm text-muted">{f.note}</p> : null}
                  {f.messageDraft ? <p className="text-xs text-muted">Draft (not sent): {f.messageDraft}</p> : null}
                  {f.outcomeNote ? <p className="text-sm text-muted">Outcome: {f.outcomeNote}</p> : null}
                  <p className="text-xs text-muted">
                    Assigned to {f.assignedStaffName ?? "nobody"} · created by {f.createdByType === "ai" ? "Zarghoon AI" : f.createdByType}
                    {f.completedAt ? ` · completed ${formatDateTime(f.completedAt)}` : ""}
                    {f.cancelledAt ? ` · cancelled ${formatDateTime(f.cancelledAt)}` : ""}
                    {f.status === "skipped" ? " · skipped" : ""}
                  </p>
                </div>
                {pending ? (
                  <div className="flex flex-col gap-2 sm:flex-row lg:w-[28rem]">
                    <ActionForm action={completeFollowupAction} hidden={{ followupId: f.id }} submitLabel="Mark completed" className="flex-1" testId="complete-followup">
                      <input name="note" maxLength={2000} placeholder="Outcome (optional)" aria-label="Outcome" className={inputClass} />
                    </ActionForm>
                    <ActionForm action={cancelFollowupAction} hidden={{ followupId: f.id }} submitLabel="Cancel" variant="danger" confirm="Cancel this follow-up?" className="flex-1" testId="cancel-followup">
                      <input name="note" maxLength={2000} placeholder="Reason (optional)" aria-label="Cancel reason" className={inputClass} />
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={r.page} pageSize={r.pageSize} total={r.total} href={(p) => hrefWith("/followups", params, { page: String(p) })} />
    </>
  );
}
