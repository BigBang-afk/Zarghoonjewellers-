import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { ActionForm } from "@/components/ActionForm";
import { Badge, EmptyState, inputClass, LeadStatusBadge, PageHeader, Tabs } from "@/components/ui";
import { resolveHandoffAction, takeOverHandoffAction } from "@/lib/actions";
import { formatDateTime, formatRelative, HANDOFF_REASON_LABELS, humanize } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function HandoffsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const status = params.status === "resolved" ? "resolved" : "open";
  const rows = await rt.dashboard.listHandoffs(viewer, status);

  return (
    <>
      <PageHeader
        title="Human handoffs"
        description="Customers waiting for a person. While a conversation is under human takeover the AI does not reply. Only staff can hand a conversation back to the AI."
      />
      <Tabs
        current={status}
        items={[
          { key: "open", label: "Waiting", href: "/handoffs" },
          { key: "resolved", label: "Resolved", href: "/handoffs?status=resolved" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title={status === "open" ? "No one is waiting" : "No resolved handoffs"} />
      ) : (
        <ul className="space-y-3" data-testid="handoff-list">
          {rows.map((h) => {
            const mine = h.assignedStaffId === viewer.id;
            const canTake = status === "open" && !mine && (!h.assignedStaffId || can.assignOthers(viewer));
            const canResolve = status === "open" && (mine || can.assignOthers(viewer));
            return (
              <li key={h.id} className={`rounded-xl border bg-surface p-4 ${h.urgency === "urgent" && status === "open" ? "border-red-200" : "border-line"}`} data-testid="handoff-item">
                <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                  <div className="space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={h.urgency === "urgent" ? "danger" : h.urgency === "high" ? "warning" : "neutral"}>{humanize(h.urgency)}</Badge>
                      <span className="font-medium">{HANDOFF_REASON_LABELS[h.reason] ?? h.reason}</span>
                      {h.humanTakeover ? <Badge tone="danger">AI paused</Badge> : <Badge tone="emerald">AI active</Badge>}
                    </p>
                    <p className="text-sm">
                      {h.customerId && (mine || can.viewAllCustomers(viewer) || h.assignedStaffId) ? (
                        <Link href={`/customers/${h.customerId}`} className="text-emerald-800 hover:underline">{h.customerName ?? "Website visitor"}</Link>
                      ) : (
                        <span>{h.customerName ?? "Website visitor"}</span>
                      )}
                      {h.leadStatus ? <span className="ml-2"><LeadStatusBadge status={h.leadStatus} /></span> : null}
                      {h.leadScore !== null ? <span className="tabular ml-2 text-xs text-muted">score {h.leadScore}</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      Requested by {h.requestedByType === "ai" ? "Zarghoon AI" : h.requestedByType} {formatRelative(h.createdAt)} · {formatDateTime(h.createdAt)}
                    </p>
                    <p className="text-xs text-muted">Assigned to: {h.assignedStaffName ?? "nobody yet"}</p>
                    {h.note ? <p className="text-sm text-muted">{h.note}</p> : null}
                    {status === "open" && (mine || can.viewAllCustomers(viewer)) ? (
                      <Link href={`/conversations/${h.conversationId}`} className="text-sm text-gold-dark hover:underline">Open conversation →</Link>
                    ) : null}
                    {h.resolvedAt ? <p className="text-xs text-muted">Resolved {formatDateTime(h.resolvedAt)}</p> : null}
                  </div>
                  <div className="flex flex-col gap-3 lg:w-80">
                    {canTake ? (
                      <ActionForm action={takeOverHandoffAction} hidden={{ handoffId: h.id }} submitLabel={h.assignedStaffId ? "Take over from colleague" : "Take over"} variant="gold" testId="take-over" />
                    ) : null}
                    {canResolve ? (
                      <ActionForm action={resolveHandoffAction} hidden={{ handoffId: h.id }} submitLabel="Resolve" variant="secondary" testId="resolve-handoff">
                        <input name="note" maxLength={2000} placeholder="Resolution note (optional)" aria-label="Resolution note" className={inputClass} />
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="releaseTakeover" /> Hand the conversation back to the AI
                        </label>
                      </ActionForm>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
