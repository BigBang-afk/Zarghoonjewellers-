import type { Metadata } from "next";
import Link from "next/link";
import { MessageThread } from "@/components/crm";
import { Badge, Card, DefinitionList, PageHeader } from "@/components/ui";
import { formatDateTime, HANDOFF_REASON_LABELS, humanize } from "@/lib/format";
import { orNotFound, pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rt, viewer } = await pageContext();
  const d = await orNotFound(rt.dashboard.getConversation(viewer, id));
  const v = d.conversation;

  return (
    <>
      <PageHeader
        title={d.customerName ?? "Website visitor"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {humanize(v.channel)} conversation <Badge>{humanize(v.status)}</Badge>
            {v.humanTakeover ? <Badge tone="danger">Human takeover — AI paused</Badge> : <Badge tone="emerald">AI active</Badge>}
          </span>
        }
        actions={
          v.customerId ? (
            <Link href={`/customers/${v.customerId}`} className="text-sm text-gold-dark hover:underline">
              Open Customer 360 →
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Messages" className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Legend">
            <Badge>Customer</Badge>
            <Badge tone="emerald">Zarghoon AI</Badge>
            <Badge tone="gold">Staff</Badge>
            <Badge>System</Badge>
          </div>
          <MessageThread messages={d.messages} />
          <p className="mt-4 rounded-lg bg-ivory p-3 text-xs text-muted">Sending messages to customers from the dashboard is not available yet. Nothing on this page contacts the customer.</p>
        </Card>
        <div className="space-y-6">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Assigned staff", d.assignedStaffName ?? "Unassigned"],
                ["Last message", formatDateTime(v.lastMessageAt) ?? "—"],
                ["Started", formatDateTime(v.createdAt)],
                ["Human takeover", v.humanTakeover ? `Since ${formatDateTime(v.humanTakeoverAt)}` : "No"],
              ]}
            />
            {v.humanTakeoverReason ? <p className="mt-3 text-xs text-muted">Reason: {v.humanTakeoverReason}</p> : null}
          </Card>
          <Card title="Handoffs">
            {d.handoffs.length === 0 ? (
              <p className="text-sm text-muted">None.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.handoffs.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span>{HANDOFF_REASON_LABELS[h.reason] ?? h.reason}</span>
                    <span className="flex gap-1">
                      <Badge tone={h.urgency === "urgent" ? "danger" : h.urgency === "high" ? "warning" : "neutral"}>{humanize(h.urgency)}</Badge>
                      <Badge tone={h.status === "open" ? "danger" : "emerald"}>{humanize(h.status)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/handoffs" className="mt-3 inline-block text-sm text-gold-dark hover:underline">
              Handoff center →
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
