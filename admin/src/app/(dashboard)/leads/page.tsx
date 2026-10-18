import Link from "next/link";
import { LEAD_STATUSES } from "@zarghoon/core/dashboard";
import { buttonClass, EmptyState, hrefWith, inputClass, LeadScore, LeadStatusBadge, Money, PageHeader, Pagination, Table, Tabs, Td, Th } from "@/components/ui";
import { formatDateTime, humanize, LEAD_STATUS_LABELS } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

const CHIPS = ["new", "warm", "hot", "very_hot", "human_followup", "won", "lost"] as const;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const result = await rt.dashboard.listLeads(viewer, params);
  const current = params.status && (LEAD_STATUSES as readonly string[]).includes(params.status) ? params.status : "all";

  return (
    <>
      <PageHeader title="Leads" description="Scores are calculated by fixed rules from recorded buying signals. Status changes use the CRM's own rules." />
      <Tabs
        current={current}
        items={[
          { key: "all", label: "All", href: hrefWith("/leads", params, { status: undefined, page: undefined }) },
          ...CHIPS.map((s) => ({ key: s, label: LEAD_STATUS_LABELS[s]!, href: hrefWith("/leads", params, { status: s, page: undefined }) })),
        ]}
      />
      <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        <input name="q" defaultValue={params.q} placeholder="Search customer name or email" aria-label="Search leads" className={inputClass} />
        <select name="assigned" defaultValue={params.assigned ?? ""} aria-label="Assignment" className={`${inputClass} sm:w-48`}>
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select name="status" defaultValue={params.status ?? ""} aria-label="Any status" className={`${inputClass} sm:w-52`}>
          <option value="">Any status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button type="submit" className={buttonClass.primary}>Apply</button>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title="No leads here">{current !== "all" ? `No leads with status “${LEAD_STATUS_LABELS[current]}”.` : "Leads are created when customers start a conversation."}</EmptyState>
      ) : (
        <>
          <Table label="Leads">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Interested in</Th>
                <Th>Budget</Th>
                <Th>Lead score</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Next follow-up</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((l) => (
                <tr key={l.id} className="hover:bg-ivory" data-testid="lead-row">
                  <Td>
                    <Link href={`/leads/${l.id}`} className="font-medium text-emerald-800 hover:underline">
                      {l.customerName ?? "Website visitor"}
                    </Link>
                  </Td>
                  <Td>{l.interestedCategory ? humanize(l.interestedCategory) : <span className="text-muted">—</span>}</Td>
                  <Td className="tabular whitespace-nowrap">{l.budgetAmount ? <Money amount={l.budgetAmount} currency={l.budgetCurrency} /> : <span className="text-muted">Not shared</span>}</Td>
                  <Td><LeadScore score={l.score} classification={l.classification} /></Td>
                  <Td><LeadStatusBadge status={l.status} /></Td>
                  <Td>{l.assignedStaffName ?? <span className="text-muted">Unassigned</span>}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(l.nextFollowupAt) ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} href={(p) => hrefWith("/leads", params, { page: String(p) })} />
        </>
      )}
    </>
  );
}
