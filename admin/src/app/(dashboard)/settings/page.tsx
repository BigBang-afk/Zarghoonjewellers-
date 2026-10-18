import { can, getFollowupSettings } from "@zarghoon/core/dashboard";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, DefinitionList, inputClass, PageHeader, Table, Td, Th } from "@/components/ui";
import { changePasswordAction, resetDemoAction, updateFollowupSettingsAction } from "@/lib/actions";
import { formatDateTime, humanize } from "@/lib/format";
import { pageContext } from "@/lib/page";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { rt, viewer } = await pageContext();
  const session = (await getSession())!;
  const staff = can.viewAllCustomers(viewer) ? await rt.dashboard.listStaff(viewer) : [];
  const fs = await getFollowupSettings(rt.db);
  const canEditFollowups = viewer.role === "owner" || viewer.role === "admin";

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Your account">
          <DefinitionList
            items={[
              ["Name", viewer.fullName],
              ["Role", humanize(viewer.role)],
              ["Username", session.username],
              ["Session ends", `${formatDateTime(session.expiresAt)} (or after 2 hours idle)`],
            ]}
          />
        </Card>
        <Card title="Change password">
          <ActionForm action={changePasswordAction} submitLabel="Change password" variant="secondary" testId="change-password">
            <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" aria-label="Current password" className={inputClass} />
            <input name="next" type="password" required minLength={12} autoComplete="new-password" placeholder="New password (12+ characters, letters and numbers)" aria-label="New password" className={inputClass} />
            <input name="confirm" type="password" required minLength={12} autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" className={inputClass} />
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Changing your password signs you out on every device.</p>
        </Card>
        <Card title="System">
          <DefinitionList
            items={[
              ["Mode", rt.mode === "demo" ? "Development demo (fake data, in memory)" : "Connected"],
              ["Database", rt.environmentLabel],
              ["Business time zone", rt.config.timezone],
            ]}
          />
        </Card>
        <Card title="Follow-up engine">
          {canEditFollowups ? (
            <ActionForm action={updateFollowupSettingsAction} submitLabel="Save follow-up settings" variant="secondary" testId="followup-settings">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted">
                  Business time zone
                  <input name="timezone" defaultValue={fs.timezone} required className={inputClass} aria-label="Business time zone" />
                </label>
                <label className="text-xs text-muted">
                  Default sequence (days)
                  <input name="defaultSequenceDays" defaultValue={fs.defaultSequenceDays.join(", ")} className={inputClass} aria-label="Default sequence days" />
                </label>
                <label className="text-xs text-muted">
                  Quiet hours start
                  <input type="time" name="quietHoursStart" defaultValue={fs.quietHours.start} className={inputClass} aria-label="Quiet hours start" />
                </label>
                <label className="text-xs text-muted">
                  Quiet hours end
                  <input type="time" name="quietHoursEnd" defaultValue={fs.quietHours.end} className={inputClass} aria-label="Quiet hours end" />
                </label>
                <label className="text-xs text-muted">
                  Processing attempts before a job is marked failed
                  <input type="number" min={1} max={10} name="maxProcessingAttempts" defaultValue={fs.maxProcessingAttempts} className={inputClass} aria-label="Max attempts" />
                </label>
                <label className="flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" name="quietHoursEnabled" defaultChecked={fs.quietHours.enabled} /> Quiet hours on
                </label>
              </div>
              <p className="text-xs text-muted">
                Times are business-local ({fs.timezone}) and stored in UTC. Customer time zones are not assumed. Writer: {rt.drafter.kind === "ai" ? `Claude (${rt.drafter.model})` : "offline templates (not AI)"}.
              </p>
            </ActionForm>
          ) : (
            <DefinitionList
              items={[
                ["Business time zone", fs.timezone],
                ["Quiet hours", fs.quietHours.enabled ? `${fs.quietHours.start}–${fs.quietHours.end}` : "Off"],
                ["Default sequence", `Day ${fs.defaultSequenceDays.join(" / ")}`],
              ]}
            />
          )}
        </Card>
        {staff.length ? (
          <Card title="Staff">
            <Table label="Staff">
              <thead>
                <tr><Th>Name</Th><Th>Role</Th><Th>Available</Th></tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}><Td>{s.fullName}</Td><Td>{humanize(s.role)}</Td><Td>{s.isAvailable ? <Badge tone="emerald">Yes</Badge> : <Badge>No</Badge>}</Td></tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-xs text-muted">
              <Badge>Not yet implemented</Badge> Adding staff and resetting their sign-in from the dashboard. Use <code>npm run staff:account</code> (core) for now.
            </p>
          </Card>
        ) : null}
        {rt.mode === "demo" && can.resetDemo(viewer) ? (
          <Card title="Demo data">
            <p className="mb-3 text-sm text-muted">Discards the in-memory demo database and creates fresh fake data. Everyone is signed out. Only available in demo mode.</p>
            <ActionForm action={resetDemoAction} submitLabel="Reset demo data" variant="danger" confirm="Reset all demo data? Everyone will be signed out." testId="reset-demo" />
          </Card>
        ) : null}
      </div>
    </>
  );
}
