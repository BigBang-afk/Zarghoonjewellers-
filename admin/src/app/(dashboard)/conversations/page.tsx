import Link from "next/link";
import { Badge, buttonClass, EmptyState, hrefWith, inputClass, PageHeader, Pagination, Table, Tabs, Td, Th } from "@/components/ui";
import { formatRelative, humanize, SENDER_LABELS } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const result = await rt.dashboard.listConversations(viewer, params);
  const tab = params.takeover === "yes" ? "takeover" : params.status === "open" ? "open" : params.status === "closed" ? "closed" : "all";

  return (
    <>
      <PageHeader title="Conversations" description="Read-only view of website chats. Replying to customers from the dashboard is not part of this step." />
      <Tabs
        current={tab}
        items={[
          { key: "all", label: "All", href: "/conversations" },
          { key: "open", label: "Open", href: "/conversations?status=open" },
          { key: "takeover", label: "Human takeover", href: "/conversations?takeover=yes" },
          { key: "closed", label: "Closed", href: "/conversations?status=closed" },
        ]}
      />
      <form method="get" className="mb-4 flex gap-2" role="search">
        {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        {params.takeover ? <input type="hidden" name="takeover" value={params.takeover} /> : null}
        <input name="q" defaultValue={params.q} placeholder="Search customer name" aria-label="Search conversations" className={inputClass} />
        <button className={buttonClass.primary} type="submit">Search</button>
      </form>
      {result.rows.length === 0 ? (
        <EmptyState title="No conversations" />
      ) : (
        <>
          <Table label="Conversations">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Last message</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Messages</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((v) => (
                <tr key={v.id} className="hover:bg-ivory" data-testid="conversation-row">
                  <Td>
                    <Link href={`/conversations/${v.id}`} className="font-medium text-emerald-800 hover:underline">
                      {v.customerName ?? "Website visitor"}
                    </Link>
                    <div className="text-xs text-muted">{humanize(v.channel)}</div>
                  </Td>
                  <Td className="max-w-sm">
                    {v.lastMessagePreview ? (
                      <span className="line-clamp-2 text-sm">
                        <span className="font-medium text-muted">{SENDER_LABELS[v.lastSenderType ?? ""] ?? ""}: </span>
                        {v.lastMessagePreview}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge>{humanize(v.status)}</Badge>
                      {v.humanTakeover ? <Badge tone="danger">Human takeover</Badge> : <Badge tone="emerald">AI active</Badge>}
                    </span>
                  </Td>
                  <Td>{v.assignedStaffName ?? <span className="text-muted">—</span>}</Td>
                  <Td className="tabular">{v.messageCount}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatRelative(v.lastMessageAt) ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} href={(p) => hrefWith("/conversations", params, { page: String(p) })} />
        </>
      )}
    </>
  );
}
