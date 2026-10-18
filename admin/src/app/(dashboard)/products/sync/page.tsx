import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { NotPermitted } from "@/components/Banners";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sync & import records" };

const SUMMARY_KEYS = ["create", "link", "update", "unchanged", "needs_sku", "invalid", "conflict", "flagged", "missingFromSource"];

export default async function SyncRecordsPage() {
  const { rt, viewer } = await pageContext();
  if (!can.viewSyncRecords(viewer)) return <NotPermitted what="Product synchronisation records" />;
  const d = await rt.dashboard.listSyncRecords(viewer);

  return (
    <>
      <PageHeader
        title="Sync & import records"
        description="Product synchronisation from the existing website is previewed and applied with the core CLI (npm run products:sync). Here you can review its approvals and results. Approving here does not apply anything by itself — the apply step re-checks the approved plan."
        actions={<Link href="/products" className="text-sm text-gold-dark hover:underline">← Products</Link>}
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><p className="text-xs uppercase tracking-wider text-muted">Products linked to a source</p><p className="tabular font-serif text-3xl font-semibold text-emerald-900">{d.linkedProducts}</p></Card>
        <Card><p className="text-xs uppercase tracking-wider text-muted">Pending batches</p><p className="tabular font-serif text-3xl font-semibold text-emerald-900">{d.approvals.filter((a) => a.status === "pending").length}</p></Card>
        <Card><p className="text-xs uppercase tracking-wider text-muted">Applied batches</p><p className="tabular font-serif text-3xl font-semibold text-emerald-900">{d.applied.length}</p></Card>
      </div>
      <Card title="Batches awaiting or after approval">
        {d.approvals.length === 0 ? (
          <EmptyState title="No sync or import batches yet" />
        ) : (
          <Table label="Sync approvals">
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Preview summary</Th>
                <Th>Status</Th>
                <Th>Requested</Th>
              </tr>
            </thead>
            <tbody>
              {d.approvals.map((a) => {
                const summary = (a.payload.summary ?? {}) as Record<string, number>;
                return (
                  <tr key={a.id}>
                    <Td>
                      <p className="font-medium">{humanize(a.payloadKind)}</p>
                      <p className="text-xs text-muted">{a.reason}</p>
                      {typeof a.payload.source === "string" ? <p className="text-xs text-muted">Source: {a.payload.source}</p> : null}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {SUMMARY_KEYS.filter((k) => summary[k]).map((k) => (
                          <Badge key={k} tone={["invalid", "conflict", "needs_sku", "flagged"].includes(k) ? "warning" : "neutral"}>
                            {humanize(k)}: {summary[k]}
                          </Badge>
                        ))}
                        {Object.keys(summary).length === 0 ? <span className="text-xs text-muted">—</span> : null}
                      </span>
                    </Td>
                    <Td><Badge tone={a.status === "pending" ? "warning" : a.status === "approved" ? "emerald" : "neutral"}>{humanize(a.status)}</Badge></Td>
                    <Td className="text-xs text-muted">{a.requestedByName ?? humanize(a.requestedByType)} · {formatDateTime(a.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-sm">
          <Link href="/approvals?kind=imports" className="text-gold-dark hover:underline">Decide pending batches in Approvals →</Link>
        </p>
      </Card>
    </>
  );
}
