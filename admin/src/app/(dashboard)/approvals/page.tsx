import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { ActionForm } from "@/components/ActionForm";
import { NotPermitted } from "@/components/Banners";
import { Badge, EmptyState, inputClass, PageHeader, Tabs } from "@/components/ui";
import { decideApprovalAction } from "@/lib/actions";
import { formatDateTime, humanize } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

/** Payload keys that are safe and useful to show (never secrets: the audit layer redacts those anyway). */
function payloadSummary(payload: Record<string, unknown>): string[] {
  return Object.entries(payload)
    .filter(([k, v]) => k !== "kind" && k !== "summary" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .slice(0, 6)
    .map(([k, v]) => `${humanize(k)}: ${String(v)}`);
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  if (!can.decideApprovals(viewer)) return <NotPermitted what="Approvals" />;
  const params = await readParams(searchParams);
  const status = ["pending", "approved", "rejected", "cancelled"].includes(params.status ?? "") ? params.status : params.kind ? undefined : "pending";
  const rows = await rt.dashboard.listApprovals(viewer, status, params.kind);
  const tab = params.kind === "imports" ? "imports" : (status ?? "all");

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Sensitive actions wait here for an owner, admin or manager. Decisions are checked and recorded on the server; an approval is used once by the workflow that requested it."
      />
      <Tabs
        current={tab}
        items={[
          { key: "pending", label: "Pending", href: "/approvals" },
          { key: "approved", label: "Approved", href: "/approvals?status=approved" },
          { key: "rejected", label: "Rejected", href: "/approvals?status=rejected" },
          { key: "cancelled", label: "Cancelled", href: "/approvals?status=cancelled" },
          { key: "imports", label: "Import & sync", href: "/approvals?kind=imports" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title={tab === "pending" ? "Nothing waiting for approval" : "No approvals here"} />
      ) : (
        <ul className="space-y-3" data-testid="approval-list">
          {rows.map((a) => (
            <li key={a.id} className="rounded-xl border border-line bg-surface p-4" data-testid="approval-item">
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{humanize(a.actionType)}</span>
                    {a.payloadKind ? <Badge>{humanize(a.payloadKind)}</Badge> : null}
                    <Badge tone={a.status === "pending" ? "warning" : a.status === "approved" ? "emerald" : "neutral"}>{humanize(a.status)}</Badge>
                  </p>
                  <p className="text-sm text-ink">{a.reason}</p>
                  {payloadSummary(a.payload).length ? <p className="text-xs text-muted">{payloadSummary(a.payload).join(" · ")}</p> : null}
                  <p className="text-xs text-muted">
                    Requested by {a.requestedByName ?? (a.requestedByType === "ai" ? "Zarghoon AI" : humanize(a.requestedByType))} · {formatDateTime(a.createdAt)}
                    {a.customerId ? (
                      <>
                        {" · "}
                        <Link href={`/customers/${a.customerId}`} className="text-emerald-800 hover:underline">{a.customerName ?? "Customer"}</Link>
                      </>
                    ) : null}
                  </p>
                  {a.status !== "pending" ? (
                    <p className="text-xs text-muted">
                      {humanize(a.status)} by {a.decidedByName ?? "—"} · {formatDateTime(a.decidedAt)}
                      {a.decisionNote ? ` — “${a.decisionNote}”` : ""}
                    </p>
                  ) : null}
                </div>
                {a.status === "pending" ? (
                  <div className="flex flex-col gap-2 sm:flex-row lg:w-[30rem]">
                    <ActionForm action={decideApprovalAction} hidden={{ approvalId: a.id, decision: "approved" }} submitLabel="Approve" variant="primary" confirm="Approve this request?" className="flex-1" testId="approve">
                      <input name="note" maxLength={2000} placeholder="Note (optional)" aria-label="Approval note" className={inputClass} />
                    </ActionForm>
                    <ActionForm action={decideApprovalAction} hidden={{ approvalId: a.id, decision: "rejected" }} submitLabel="Reject" variant="danger" confirm="Reject this request?" className="flex-1" testId="reject">
                      <input name="note" maxLength={2000} placeholder="Reason (optional)" aria-label="Rejection reason" className={inputClass} />
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
