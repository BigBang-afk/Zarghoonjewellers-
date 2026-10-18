import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { NotPermitted } from "@/components/Banners";
import { Badge, EmptyState, hrefWith, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  if (!can.viewAudit(viewer)) return <NotPermitted what="The activity log" />;
  const params = await readParams(searchParams);
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const { category, rows } = await rt.dashboard.listActivity(viewer, params.category, page);

  return (
    <>
      <PageHeader title="Activity log" description="The audit trail of AI, staff and system actions. Inputs are stored with secrets redacted and are not shown here." />
      <Tabs
        current={category}
        items={[
          { key: "all", label: "All", href: "/activity" },
          { key: "ai", label: "AI actions", href: "/activity?category=ai" },
          { key: "sensitive", label: "Sensitive", href: "/activity?category=sensitive" },
          { key: "sign_in", label: "Sign-in", href: "/activity?category=sign_in" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No activity" />
      ) : (
        <Table label="Activity">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>By</Th>
              <Th>Customer</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} data-testid="activity-row">
                <Td className="whitespace-nowrap text-muted">{formatDateTime(a.createdAt)}</Td>
                <Td>
                  {humanize(a.actionType)}
                  {a.toolName ? <span className="block text-xs text-muted">tool: {a.toolName}</span> : null}
                </Td>
                <Td>{a.actorType === "ai" ? `Zarghoon AI${a.agentName ? ` (${humanize(a.agentName)})` : ""}` : a.actorType === "staff" ? (a.actorName ?? "Staff") : "System"}</Td>
                <Td>{a.customerId ? <Link className="text-emerald-800 hover:underline" href={`/customers/${a.customerId}`}>{a.customerName ?? "Website visitor"}</Link> : <span className="text-muted">—</span>}</Td>
                <Td>
                  <Badge tone={a.status === "succeeded" ? "emerald" : a.status === "failed" || a.status === "rejected" ? "danger" : "warning"}>{humanize(a.status)}</Badge>
                  {a.errorMessage ? <span className="block text-xs text-muted">{a.errorMessage}</span> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-3 flex justify-end gap-2 text-sm">
        {page > 1 ? <Link className="rounded-md border border-line px-3 py-1" href={hrefWith("/activity", params, { page: String(page - 1) })}>Newer</Link> : null}
        {rows.length === 50 ? <Link className="rounded-md border border-line px-3 py-1" href={hrefWith("/activity", params, { page: String(page + 1) })}>Older</Link> : null}
      </div>
    </>
  );
}
