import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { MessageThread, ScheduleFollowupForm, ScoreBreakdown } from "@/components/crm";
import { Badge, Card, DefinitionList, EmptyState, LeadStatusBadge, Money, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatMoney, HANDOFF_REASON_LABELS, humanize } from "@/lib/format";
import { orNotFound, pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer 360" };

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rt, viewer } = await pageContext();
  const c = await orNotFound(rt.dashboard.getCustomerDetail(viewer, id));
  const staff = can.assignOthers(viewer) ? await rt.dashboard.listStaff(viewer) : [];
  const customer = c.customer;
  const lead = c.activeLead;
  const lifetime = Object.entries(c.ordersSummary.lifetimeValueByCurrency);

  return (
    <>
      <PageHeader
        title={customer.fullName ?? "Website visitor"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Customer 360</span>
            {c.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
            {c.humanTakeoverStatus.active ? <Badge tone="danger">Human takeover active</Badge> : null}
            {lead ? <LeadStatusBadge status={lead.status} /> : null}
          </span>
        }
        actions={
          <Link href="/customers" className="text-sm text-gold-dark hover:underline">
            ← All customers
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Identity & contact">
            <DefinitionList
              items={[
                ["Name", customer.fullName ?? <span className="text-muted">Not provided</span>],
                ["Phone", customer.phone ?? <span className="text-muted">—</span>],
                ["WhatsApp", customer.whatsappNumber ?? <span className="text-muted">—</span>],
                ["Email", customer.email ?? <span className="text-muted">—</span>],
                ["City", customer.city ?? <span className="text-muted">—</span>],
                ["Preferred language", humanize(customer.preferredLanguage)],
                ["Customer since", formatDateTime(customer.createdAt)],
                ["Last contact", formatDateTime(customer.lastContactAt) ?? "—"],
                ["Assigned salesperson", c.assignedStaff?.fullName ?? <span className="text-muted">Unassigned</span>],
                [
                  "Linked identities",
                  c.externalIdentities.length ? c.externalIdentities.map((i) => humanize(i.type) + (i.isVerified ? " (verified)" : "")).join(", ") : "—",
                ],
              ]}
            />
            {customer.notes ? <p className="mt-4 whitespace-pre-wrap rounded-lg bg-ivory p-3 text-sm">{customer.notes}</p> : null}
          </Card>

          <Card
            title="Recent messages"
            actions={
              c.recentConversations[0] ? (
                <Link href={`/conversations/${c.recentConversations[0].id}`} className="text-sm text-gold-dark hover:underline">
                  Open conversation →
                </Link>
              ) : null
            }
          >
            <MessageThread messages={c.recentMessages} />
          </Card>

          <Card title="Interested jewellery">
            {c.productInterests.length === 0 ? (
              <p className="text-sm text-muted">No product interest recorded.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {c.productInterests.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/products/${p.productId}`} className="text-emerald-800 hover:underline">
                      {p.productName} <span className="text-xs text-muted">({p.productSku})</span>
                    </Link>
                    <span className="flex items-center gap-2">
                      <Badge>{humanize(p.interestType)}</Badge>
                      <span className="text-xs text-muted">{formatDateTime(p.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Conversations">
            {c.conversations.length === 0 ? (
              <p className="text-sm text-muted">No conversations.</p>
            ) : (
              <Table label="Conversations">
                <thead>
                  <tr>
                    <Th>Channel</Th>
                    <Th>Status</Th>
                    <Th>Messages</Th>
                    <Th>Assigned</Th>
                    <Th>Last message</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.conversations.map((v) => (
                    <tr key={v.id}>
                      <Td>
                        <Link className="text-emerald-800 hover:underline" href={`/conversations/${v.id}`}>
                          {humanize(v.channel)}
                        </Link>
                      </Td>
                      <Td>
                        <span className="flex gap-1">
                          <Badge>{humanize(v.status)}</Badge>
                          {v.humanTakeover ? <Badge tone="danger">Takeover</Badge> : null}
                        </span>
                      </Td>
                      <Td className="tabular">{v.messageCount}</Td>
                      <Td>{v.assignedStaffName ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-muted">{formatDateTime(v.lastMessageAt) ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Orders">
            {c.orders.length === 0 ? (
              <EmptyState title="No orders recorded">Orders appear here only when they are recorded in Zarghoon AI. Website checkout is not connected.</EmptyState>
            ) : (
              <>
                <Table label="Orders">
                  <thead>
                    <tr>
                      <Th>Order</Th>
                      <Th>Status</Th>
                      <Th>Payment</Th>
                      <Th className="text-right">Total</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.orders.map((o) => (
                      <tr key={o.id}>
                        <Td className="font-medium">{o.orderNumber}</Td>
                        <Td><Badge>{humanize(o.status)}</Badge></Td>
                        <Td>{humanize(o.paymentStatus)}</Td>
                        <Td className="tabular text-right"><Money amount={o.total} currency={o.currency} /></Td>
                        <Td className="text-muted">{formatDateTime(o.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-2 text-xs text-muted">
                  Lifetime value (confirmed or delivered orders): {lifetime.length ? lifetime.map(([cur, v]) => formatMoney(v, cur)).join(" · ") : "none"}
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Lead score">
            {lead ? (
              <div className="mb-2 flex justify-end">
                <Link href={`/leads/${lead.id}`} className="text-sm text-gold-dark hover:underline">
                  Open lead →
                </Link>
              </div>
            ) : null}
            <ScoreBreakdown score={c.leadScore} classification={c.leadClassification} breakdown={c.leadScoreBreakdown} events={c.signalEvents} />
          </Card>

          <Card title="Human handoff">
            {c.humanTakeoverStatus.openHandoffs.length === 0 && !c.humanTakeoverStatus.active ? (
              <p className="text-sm text-muted">No open handoff. Zarghoon AI may reply.</p>
            ) : (
              <div className="space-y-2 text-sm" data-testid="handoff-status">
                {c.humanTakeoverStatus.active ? <p className="font-medium text-danger">A person has taken over — the AI will not reply.</p> : null}
                {c.humanTakeoverStatus.openHandoffs.map((h) => (
                  <p key={h.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.urgency === "urgent" ? "danger" : h.urgency === "high" ? "warning" : "neutral"}>{humanize(h.urgency)}</Badge>
                    {HANDOFF_REASON_LABELS[h.reason] ?? h.reason}
                  </p>
                ))}
                <Link href="/handoffs" className="text-gold-dark hover:underline">
                  Go to the handoff center →
                </Link>
              </div>
            )}
          </Card>

          <Card title="Follow-ups">
            {c.pendingFollowups.length ? (
              <ul className="mb-4 space-y-2 text-sm">
                {c.pendingFollowups.map((f) => (
                  <li key={f.id} className="rounded-lg bg-ivory p-2">
                    <p className="font-medium">{formatDateTime(f.scheduledFor)}</p>
                    <p className="text-xs text-muted">
                      {humanize(f.followupType)}
                      {f.note ? ` · ${f.note}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No pending follow-ups.</p>
            )}
            <ScheduleFollowupForm
              customerId={customer.id}
              leadId={lead?.id}
              staff={staff}
              canAssignOthers={can.assignOthers(viewer)}
              viewerId={viewer.id}
              defaultAssigneeId={c.assignedStaff?.id}
              disabledReason={c.doNotContact ? "This customer asked not to be contacted. Follow-ups cannot be scheduled." : null}
            />
            {c.followupHistory.some((f) => f.status !== "pending") ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted">History</summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {c.followupHistory
                    .filter((f) => f.status !== "pending")
                    .map((f) => (
                      <li key={f.id}>
                        {formatDateTime(f.scheduledFor)} · {humanize(f.status)}
                        {f.outcomeNote ? ` — ${f.outcomeNote}` : ""}
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
          </Card>

          <Card title="Lead history">
            {c.leadHistory.length === 0 ? (
              <p className="text-sm text-muted">No leads.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.leadHistory.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${l.id}`} className="text-emerald-800 hover:underline">
                      {formatDateTime(l.createdAt)}
                    </Link>
                    <span className="flex items-center gap-2">
                      <LeadStatusBadge status={l.status} />
                      <span className="tabular text-xs text-muted">{l.score}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
