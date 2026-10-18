import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { formatMoney, formatRelative, humanize, LEAD_STATUS_LABELS } from "@/lib/format";
import { pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";

const PIPELINE_ORDER = ["new", "qualified", "warm", "hot", "very_hot", "waiting_customer", "human_followup", "won", "lost", "do_not_contact"];

export default async function OverviewPage() {
  const { rt, viewer } = await pageContext();
  const o = await rt.dashboard.getOverview(viewer);
  const scoped = !can.viewAllCustomers(viewer);
  const revenue = Object.entries(o.orders.revenueByCurrency);
  const maxPipeline = Math.max(1, ...o.pipeline.map((p) => p.count));

  return (
    <>
      <PageHeader
        title="Overview"
        description={scoped ? "Your customers, leads and follow-ups." : "Every figure below is counted from stored records — nothing is estimated."}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Customers" value={o.totalCustomers} href="/customers" />
        <StatCard label="New leads today" value={o.newLeadsToday} href="/leads" />
        <StatCard label="Active leads" value={o.activeLeads} href="/leads" />
        <StatCard label="Hot leads" value={o.hotLeads} href="/leads?status=hot" tone="gold" />
        <StatCard label="Very hot leads" value={o.veryHotLeads} href="/leads?status=very_hot" tone="gold" />
        <StatCard label="Human handoffs" value={o.openHandoffs} href="/handoffs" tone={o.openHandoffs ? "danger" : "neutral"} hint="Waiting for staff" />
        <StatCard label="Pending follow-ups" value={o.pendingFollowups} href="/followups?tab=upcoming" />
        <StatCard label="Overdue follow-ups" value={o.overdueFollowups} href="/followups?tab=overdue" tone={o.overdueFollowups ? "danger" : "neutral"} />
        <StatCard label="Available products" value={o.availableProducts} href="/products?stock=available" tone="emerald" hint="Available or low stock" />
        <StatCard label="Low stock" value={o.lowStockProducts} href="/products?stock=low_stock" />
        <StatCard
          label="Orders"
          value={o.orders.total}
          href="/orders"
          hint={o.orders.total ? `${o.orders.open} open` : "None recorded in Zarghoon AI"}
        />
        <StatCard
          label="Revenue"
          value={revenue.length ? <span className="text-2xl">{revenue.map(([c, v]) => formatMoney(v, c)).join(" · ")}</span> : <span className="text-base font-normal italic text-muted">Not available</span>}
          hint={revenue.length ? "Confirmed and delivered orders" : "No confirmed order values recorded"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card title="Lead pipeline" className="xl:col-span-2">
          <ul className="space-y-2" data-testid="pipeline">
            {PIPELINE_ORDER.map((status) => {
              const count = o.pipeline.find((p) => p.status === status)?.count ?? 0;
              return (
                <li key={status}>
                  <Link href={`/leads?status=${status}`} className="group grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm">
                    <span className="text-ink group-hover:text-emerald-800">{LEAD_STATUS_LABELS[status]}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-stone-100">
                      <span className="block h-full rounded-full bg-emerald-700" style={{ width: `${(count / maxPipeline) * 100}%` }} />
                    </span>
                    <span className="tabular text-right font-medium">{count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Recent activity" className="xl:col-span-3">
          {o.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-line" data-testid="recent-activity">
              {o.recentActivity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="text-ink">
                      {humanize(a.actionType)}
                      {a.customerName || a.customerId ? (
                        <>
                          {" · "}
                          <Link className="text-emerald-800 hover:underline" href={`/customers/${a.customerId}`}>
                            {a.customerName ?? "Website visitor"}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {a.actorType === "ai" ? "Zarghoon AI" : a.actorType === "staff" ? (a.actorName ?? "Staff") : "System"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted">{formatRelative(a.createdAt)}</span>
                    {a.status !== "succeeded" ? <Badge tone={a.status === "failed" ? "danger" : "warning"}>{humanize(a.status)}</Badge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
