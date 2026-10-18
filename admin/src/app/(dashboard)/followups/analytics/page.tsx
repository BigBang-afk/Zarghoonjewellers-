import type { Metadata } from "next";
import Link from "next/link";
import { PURPOSE_META, type FollowupPurpose } from "@zarghoon/core/dashboard";
import { Card, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { humanize } from "@/lib/format";
import { pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-up analytics" };

function NotAvailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface p-4" data-testid={`na-${label}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-serif text-xl font-semibold text-muted">Not available</p>
      <p className="mt-1 text-xs text-muted">{reason}</p>
    </div>
  );
}

export default async function FollowupAnalyticsPage() {
  const { rt, viewer } = await pageContext();
  const a = await rt.followups.analytics(viewer);
  const f = a.followups;
  const d = a.drafts;
  return (
    <>
      <PageHeader
        title="Follow-up analytics"
        description="Counted from stored records only. Draft creation, staff approval, delivery and customer response are separate stages — only the first two exist today."
        actions={<Link href="/followups" className="text-sm text-gold-dark hover:underline">← Follow-up Center</Link>}
      />
      <h2 className="mb-2 font-serif text-xl font-semibold text-emerald-900">Follow-ups</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Scheduled (all time)" value={f.scheduled} />
        <StatCard label="Pending" value={f.pending} />
        <StatCard label="Completed" value={f.completed} tone="emerald" />
        <StatCard label="Cancelled" value={f.cancelled} />
        <StatCard label="Overdue" value={f.overdue} tone={f.overdue ? "danger" : "neutral"} />
        <StatCard label="Customer replied after scheduling" value={f.customer_replied} hint="Reply observed; not attributed to a message" />
      </div>
      <h2 className="mb-2 mt-6 font-serif text-xl font-semibold text-emerald-900">Pipeline stages</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="1. Drafts created" value={d.created} hint={`${d.by_ai} Claude · ${d.by_template} template · ${d.by_staff} staff`} />
        <StatCard label="Awaiting review" value={d.awaiting_review} tone={d.awaiting_review ? "gold" : "neutral"} />
        <StatCard label="2. Approved by staff" value={d.approved} tone="emerald" />
        <StatCard label="Rejected by staff" value={d.rejected} />
        <NotAvailable label="3. Delivered" reason={a.delivered.reason} />
        <NotAvailable label="4. Customer response" reason={a.averageResponseTime.reason} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <NotAvailable label="Average response time" reason={a.averageResponseTime.reason} />
        <NotAvailable label="Follow-up to sale conversion" reason={a.conversion.reason} />
      </div>
      <Card title="By follow-up type" className="mt-6">
        <Table label="Follow-ups by type">
          <thead>
            <tr><Th>Type</Th><Th className="text-right">Follow-ups</Th></tr>
          </thead>
          <tbody>
            {a.byPurpose.map((p) => (
              <tr key={`${p.purpose}-${p.followupType}`}>
                <Td>{p.purpose ? PURPOSE_META[p.purpose as FollowupPurpose]?.label ?? humanize(p.purpose) : `${humanize(p.followupType)} (before Step 9)`}</Td>
                <Td className="tabular text-right">{p.count}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
