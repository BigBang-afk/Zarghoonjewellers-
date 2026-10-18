import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Badge, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { markNotificationsReadAction } from "@/lib/actions";
import { formatRelative } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const all = params.show === "all";
  const items = await rt.followups.notifications(viewer, { includeResolved: all });
  const unread = items.filter((n) => !n.read && !n.resolvedAt);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Internal alerts for your follow-ups and customers waiting for a person. Nothing here is sent outside the dashboard."
        actions={
          unread.length ? (
            <ActionForm action={markNotificationsReadAction} submitLabel="Mark all as read" variant="secondary" testId="mark-all-read">
              {unread.map((n) => (
                <input key={n.id} type="hidden" name="notificationId" value={n.id} />
              ))}
            </ActionForm>
          ) : null
        }
      />
      <Tabs
        current={all ? "all" : "open"}
        items={[
          { key: "open", label: "Open", href: "/notifications" },
          { key: "all", label: "Including resolved", href: "/notifications?show=all" },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="notification-list">
          {items.map((n) => (
            <li key={n.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${n.read || n.resolvedAt ? "opacity-70" : ""}`} data-testid="notification">
              <div className="text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={n.severity === "critical" ? "danger" : n.severity === "warning" ? "warning" : "neutral"}>{n.kind.replace(/_/g, " ")}</Badge>
                  <span className="font-medium">{n.title}</span>
                  {!n.read && !n.resolvedAt ? <span className="h-2 w-2 rounded-full bg-gold" aria-label="unread" /> : null}
                  {n.resolvedAt ? <Badge tone="emerald">resolved</Badge> : null}
                </p>
                {n.body ? <p className="text-xs text-muted">{n.body}</p> : null}
                <p className="mt-1 flex gap-3 text-xs">
                  {n.followupId ? <Link className="text-gold-dark hover:underline" href={`/followups/${n.followupId}`}>Open follow-up</Link> : null}
                  {n.handoffId ? <Link className="text-gold-dark hover:underline" href="/handoffs">Handoff center</Link> : null}
                  {n.customerId ? <Link className="text-emerald-800 hover:underline" href={`/customers/${n.customerId}`}>{n.customerName ?? "Website visitor"}</Link> : null}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">{formatRelative(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
