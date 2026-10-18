import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@zarghoon/core/dashboard";
import { ActionForm } from "@/components/ActionForm";
import { ScheduleFollowupForm, ScoreBreakdown } from "@/components/crm";
import { Badge, Card, DefinitionList, inputClass, LeadScore, LeadStatusBadge, Money, PageHeader } from "@/components/ui";
import { addLeadNoteAction, assignLeadAction, markLeadLostAction, markLeadWonAction } from "@/lib/actions";
import { formatDateTime, humanize } from "@/lib/format";
import { orNotFound, pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rt, viewer } = await pageContext();
  const d = await orNotFound(rt.dashboard.getLeadDetail(viewer, id));
  const lead = d.lead;
  const closed = ["won", "lost", "do_not_contact"].includes(lead.status);
  const staff = await rt.dashboard.listStaff(viewer);

  return (
    <>
      <PageHeader
        title={d.customerName ?? "Website visitor"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Lead <LeadStatusBadge status={lead.status} /> <LeadScore score={lead.score} classification={lead.scoreClassification} />
            {d.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
          </span>
        }
        actions={
          <Link href={`/customers/${lead.customerId}`} className="text-sm text-gold-dark hover:underline">
            Open Customer 360 →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Status", <LeadStatusBadge key="s" status={lead.status} />],
                ["Source", humanize(lead.sourceChannel) || "—"],
                ["Budget", lead.budgetAmount ? <Money amount={lead.budgetAmount} currency={lead.budgetCurrency} /> : "Not shared"],
                ["Assigned", d.assignedStaffName ?? "Unassigned"],
                ["Created", formatDateTime(lead.createdAt)],
                ["Last activity", formatDateTime(lead.lastActivityAt)],
                ...(lead.wonAt ? ([["Won", formatDateTime(lead.wonAt)]] as [string, string | null][]) : []),
                ...(lead.lostAt ? ([["Lost", `${formatDateTime(lead.lostAt)} — ${lead.lostReason ?? ""}`]] as [string, string][]) : []),
              ]}
            />
          </Card>

          <Card title="Notes">
            {lead.notes ? <pre className="mb-4 whitespace-pre-wrap rounded-lg bg-ivory p-3 font-sans text-sm" data-testid="lead-notes">{lead.notes}</pre> : <p className="mb-4 text-sm text-muted">No notes yet.</p>}
            {!closed ? (
              <ActionForm action={addLeadNoteAction} hidden={{ leadId: lead.id }} submitLabel="Add note" variant="secondary" testId="add-note">
                <textarea name="note" required maxLength={1000} rows={2} placeholder="Add a note (saved with your name and the time)" aria-label="Note" className={inputClass} />
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">This lead is closed.</p>
            )}
          </Card>

          <Card title="Follow-ups">
            <ul className="mb-4 space-y-1 text-sm">
              {d.followups.length === 0 ? <li className="text-muted">None.</li> : null}
              {d.followups.map((f) => (
                <li key={f.id} className="flex justify-between gap-2">
                  <span>
                    {formatDateTime(f.scheduledFor)} · {humanize(f.followupType)}
                    {f.note ? ` — ${f.note}` : ""}
                  </span>
                  <Badge>{humanize(f.status)}</Badge>
                </li>
              ))}
            </ul>
            <ScheduleFollowupForm
              customerId={lead.customerId}
              leadId={lead.id}
              staff={staff}
              canAssignOthers={can.assignOthers(viewer)}
              viewerId={viewer.id}
              defaultAssigneeId={lead.assignedStaffId}
              disabledReason={d.doNotContact ? "This customer asked not to be contacted." : closed ? "Closed leads cannot get new sales follow-ups." : null}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Score breakdown">
            <ScoreBreakdown score={closed ? lead.score : d.score.score} classification={closed ? lead.scoreClassification : d.score.classification} breakdown={d.score.breakdown} events={d.signalEvents} />
          </Card>

          {!closed && can.assignOthers(viewer) ? (
            <Card title="Assign">
              <ActionForm action={assignLeadAction} hidden={{ leadId: lead.id }} submitLabel="Assign" variant="secondary" testId="assign-lead">
                <select name="staffId" defaultValue={lead.assignedStaffId ?? ""} required aria-label="Staff member" className={inputClass}>
                  <option value="" disabled>Choose staff…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} · {humanize(s.role)}
                      {s.isAvailable ? " · available" : ""}
                    </option>
                  ))}
                </select>
              </ActionForm>
            </Card>
          ) : null}

          {!closed ? (
            <Card title="Close lead">
              <div className="space-y-4">
                <ActionForm action={markLeadWonAction} hidden={{ leadId: lead.id }} submitLabel="Mark as won" variant="primary" confirm="Mark this lead as won?" testId="mark-won">
                  <input name="note" maxLength={1000} placeholder="Note (optional)" aria-label="Won note" className={inputClass} />
                </ActionForm>
                <ActionForm action={markLeadLostAction} hidden={{ leadId: lead.id }} submitLabel="Mark as lost" variant="danger" confirm="Mark this lead as lost?" testId="mark-lost">
                  <input name="reason" required maxLength={1000} placeholder="Reason (required)" aria-label="Lost reason" className={inputClass} />
                </ActionForm>
                <p className="text-xs text-muted">Closing a lead cancels its pending sales follow-ups. Only staff can do this — never the AI.</p>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
