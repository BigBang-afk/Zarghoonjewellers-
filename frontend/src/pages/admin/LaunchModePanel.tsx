import { useEffect, useState } from "react"
import { Rocket, Plus, Trash2, Download, Users } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { City, InvitationCode, PilotModeSettings, WaitlistEntry } from "../../types"

function PilotModeSection() {
  const { push } = useToast()
  const [settings, setSettings] = useState<PilotModeSettings | null>(null)
  const [current, setCurrent] = useState<{ driverCount: number; passengerCount: number } | null>(null)
  const [cities, setCities] = useState<City[]>([])
  const [saving, setSaving] = useState(false)

  function load() {
    adminApi
      .pilotMode()
      .then((r) => {
        setSettings(r.settings)
        setCurrent(r.current)
      })
      .catch((err) => push("error", errorMessage(err)))
    adminApi.cities().then((r) => setCities(r.cities)).catch(() => {})
  }

  useEffect(load, [])

  async function save(patch: Partial<PilotModeSettings>) {
    if (!settings) return
    setSaving(true)
    try {
      const r = await adminApi.updatePilotMode(patch)
      setSettings(r.settings)
      push("success", "Pilot mode settings updated.")
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <LoadingState label="Loading pilot mode…" />

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">Pilot mode</p>
          <p className="text-xs text-ink-700/60">A controlled-launch gate, checked at registration. Off by default.</p>
        </div>
        <Badge tone={settings.enabled ? "success" : "neutral"}>{settings.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant={settings.enabled ? "secondary" : "primary"} onClick={() => save({ enabled: !settings.enabled })} disabled={saving}>
          {settings.enabled ? "Disable pilot mode" : "Enable pilot mode"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-ink-700/60">
          Pilot city
          <select
            value={settings.cityId}
            onChange={(e) => save({ cityId: e.target.value })}
            disabled={saving}
            className="mt-1 h-10 w-full rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
          >
            <option value="">No city restriction (platform-wide)</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-bold text-ink-700/60">
          Max driver count (0 = no cap)
          <input
            type="number"
            min={0}
            defaultValue={settings.maxDriverCount}
            onBlur={(e) => save({ maxDriverCount: Number(e.target.value) })}
            className="mt-1 h-10 w-full rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
          />
        </label>

        <label className="text-xs font-bold text-ink-700/60">
          Max passenger count (0 = no cap)
          <input
            type="number"
            min={0}
            defaultValue={settings.maxPassengerCount}
            onBlur={(e) => save({ maxPassengerCount: Number(e.target.value) })}
            className="mt-1 h-10 w-full rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
          />
        </label>

        <label className="flex items-center gap-2 pt-6 text-xs font-bold text-ink-700/60">
          <input type="checkbox" checked={settings.requireInvitationCode} onChange={(e) => save({ requireInvitationCode: e.target.checked })} disabled={saving} />
          Require an invitation code to sign up
        </label>
      </div>

      {current && (
        <div className="mt-3 flex gap-4 border-t border-ink-900/10 pt-3 text-xs text-ink-700/60">
          <span>
            <strong className="text-ink-900">{current.driverCount}</strong> drivers registered
            {settings.cityId ? " in pilot city" : ""}
          </span>
          <span>
            <strong className="text-ink-900">{current.passengerCount}</strong> passengers registered
          </span>
        </div>
      )}
    </Card>
  )
}

function InvitationCodesSection() {
  const { push } = useToast()
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState("")
  const [maxUses, setMaxUses] = useState("1")
  const [submitting, setSubmitting] = useState(false)

  function load() {
    adminApi
      .invitationCodes()
      .then((r) => setCodes(r.codes))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function create() {
    if (!code.trim()) {
      push("error", "Enter a code.")
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createInvitationCode({ code: code.trim(), maxUses: maxUses ? Number(maxUses) : undefined })
      push("success", "Invitation code created.")
      setCode("")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(c: InvitationCode) {
    try {
      await adminApi.updateInvitationCode(c.id, { isActive: !c.isActive })
      load()
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-1 text-sm font-bold">Invitation codes</p>
      <p className="mb-3 text-xs text-ink-700/60">Doubles as a beta user list — one single-use code per approved person.</p>

      <div className="mb-3 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" className="h-10 w-40 rounded-lg border border-ink-900/10 px-3 text-sm uppercase outline-none focus:border-rivo-500" />
        <input
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="Max uses"
          className="h-10 w-28 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
        />
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={create} disabled={submitting}>
          Create
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading codes…" />
      ) : codes.length === 0 ? (
        <p className="text-xs text-ink-700/50">No invitation codes yet.</p>
      ) : (
        <div className="space-y-1.5">
          {codes.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-xs">
              <div>
                <code className="font-bold">{c.code}</code>
                <span className="ml-2 text-ink-700/50">
                  {c.usedCount}/{c.maxUses ?? "∞"} used
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                <button onClick={() => toggleActive(c)} className="font-bold text-rivo-600">
                  {c.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function WaitlistSection() {
  const { push } = useToast()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    adminApi
      .waitlist()
      .then((r) => setEntries(r.entries))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function remove(id: string) {
    if (!confirm("Remove this waitlist entry?")) return
    try {
      await adminApi.deleteWaitlistEntry(id)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  function exportCsv() {
    const header = "fullName,contact,cityName,userType,marketingConsent,createdAt"
    const rows = entries.map((e) => [e.fullName, e.contact, e.cityName, e.userType, e.marketingConsent, e.createdAt].join(","))
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "waitlist.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">Waitlist ({entries.length})</p>
          <p className="text-xs text-ink-700/60">Pre-launch sign-ups collected ahead of a city going live.</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={entries.length === 0}>
          Export CSV
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading waitlist…" />
      ) : entries.length === 0 ? (
        <EmptyState icon={Users} title="No waitlist entries" description="Sign-ups from the landing page will appear here." />
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-xs">
              <div>
                <span className="font-bold">{e.fullName}</span>
                <span className="ml-2 text-ink-700/50">
                  {e.contact} · {e.cityName} · {e.userType}
                </span>
              </div>
              <button onClick={() => remove(e.id)} className="text-danger-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function LaunchModePanel() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Launch mode</h1>
        <p className="flex items-center gap-1.5 text-sm text-ink-700/60">
          <Rocket className="h-4 w-4" /> Controls for rolling out to a new city in a controlled way: pilot mode caps, invitation codes, and the pre-launch waitlist.
        </p>
      </div>

      <div className="space-y-4">
        <PilotModeSection />
        <InvitationCodesSection />
        <WaitlistSection />
      </div>
    </div>
  )
}
