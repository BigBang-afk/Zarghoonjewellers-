import Link from "next/link";
import { LEAD_STATUSES } from "@zarghoon/core/dashboard";
import { Badge, buttonClass, EmptyState, hrefWith, inputClass, LeadScore, LeadStatusBadge, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { CLASSIFICATION_LABELS, formatRelative, humanize, LEAD_STATUS_LABELS } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const result = await rt.dashboard.listCustomers(viewer, params);
  const filtered = !!(params.q || params.leadStatus || params.classification || params.language);

  return (
    <>
      <PageHeader title="Customers" description="Contact details are shown only for customers you are responsible for (all customers for managers and above)." />

      <form method="get" className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <input name="q" defaultValue={params.q} placeholder="Search name, phone, email or city" aria-label="Search customers" className={`${inputClass} lg:col-span-2`} />
        <select name="leadStatus" defaultValue={params.leadStatus ?? ""} aria-label="Lead status" className={inputClass}>
          <option value="">Any lead status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select name="classification" defaultValue={params.classification ?? ""} aria-label="Lead temperature" className={inputClass}>
          <option value="">Any temperature</option>
          {Object.entries(CLASSIFICATION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="language" defaultValue={params.language ?? ""} aria-label="Language" className={inputClass}>
          <option value="">Any language</option>
          {["english", "urdu", "roman_urdu", "unknown"].map((l) => (
            <option key={l} value={l}>{humanize(l)}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={params.sort ?? "last_contact"} aria-label="Sort by" className={inputClass}>
            <option value="last_contact">Last contact</option>
            <option value="score">Lead score</option>
            <option value="name">Name</option>
            <option value="created">Newest</option>
          </select>
          <button className={buttonClass.primary} type="submit">Apply</button>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title={filtered ? "No customers match these filters" : "No customers yet"}>
          {filtered ? <Link href="/customers" className="text-gold-dark underline">Clear filters</Link> : "Customers appear here when they chat on the website or are added by staff."}
        </EmptyState>
      ) : (
        <>
          <Table label="Customers">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th>Email</Th>
                <Th>City</Th>
                <Th>Language</Th>
                <Th>Lead status</Th>
                <Th>Lead score</Th>
                <Th>Last contact</Th>
                <Th>Assigned</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((c) => (
                <tr key={c.id} className="hover:bg-ivory" data-testid="customer-row">
                  <Td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-emerald-800 hover:underline">
                      {c.fullName ?? "Website visitor (no name)"}
                    </Link>
                    {c.doNotContact ? <div className="mt-1"><Badge tone="danger">Do not contact</Badge></div> : null}
                  </Td>
                  <Td className="tabular whitespace-nowrap">{c.phone ?? <span className="text-muted">—</span>}</Td>
                  <Td>{c.email ?? <span className="text-muted">—</span>}</Td>
                  <Td>{c.city ?? <span className="text-muted">—</span>}</Td>
                  <Td>{humanize(c.preferredLanguage)}</Td>
                  <Td><LeadStatusBadge status={c.leadStatus} /></Td>
                  <Td><LeadScore score={c.leadScore} classification={c.leadClassification} /></Td>
                  <Td className="whitespace-nowrap text-muted">{formatRelative(c.lastContactAt) ?? "—"}</Td>
                  <Td>{c.assignedStaffName ?? <span className="text-muted">Unassigned</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} href={(p) => hrefWith("/customers", params, { page: String(p) })} />
        </>
      )}
    </>
  );
}
