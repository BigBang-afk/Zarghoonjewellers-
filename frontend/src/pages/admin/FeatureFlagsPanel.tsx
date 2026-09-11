import { useEffect, useState } from "react"
import { Flag, Plus, Trash2 } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { FeatureFlag } from "../../types"

function NewFlagForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useToast()
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [targetRole, setTargetRole] = useState<"all" | "passenger" | "driver">("all")
  const [submitting, setSubmitting] = useState(false)

  async function create() {
    if (!key.trim() || !name.trim()) {
      push("error", "Fill in a key and name.")
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createFeatureFlag({ key: key.trim().toLowerCase(), name: name.trim(), targetRole, isEnabled: false, rolloutPct: 100 })
      push("success", "Flag created (disabled by default).")
      setKey(""); setName("")
      onCreated()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold">New flag</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key (e.g. new_checkout)" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as "all" | "passenger" | "driver")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="all">All roles</option>
          <option value="passenger">Passengers only</option>
          <option value="driver">Drivers only</option>
        </select>
      </div>
      <Button className="mt-3" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={create} disabled={submitting}>
        {submitting ? "Creating…" : "Create flag"}
      </Button>
    </Card>
  )
}

export function FeatureFlagsPanel() {
  const { push } = useToast()
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    adminApi.featureFlags().then((r) => setFlags(r.flags)).catch((err) => push("error", errorMessage(err))).finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function toggle(flag: FeatureFlag) {
    setBusyId(flag.id)
    try {
      await adminApi.updateFeatureFlag(flag.id, { isEnabled: !flag.isEnabled })
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function updateRollout(flag: FeatureFlag, pct: number) {
    setBusyId(flag.id)
    try {
      await adminApi.updateFeatureFlag(flag.id, { rolloutPct: pct })
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this flag? Any code checking it will get false immediately.")) return
    setBusyId(id)
    try {
      await adminApi.deleteFeatureFlag(id)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Feature flags</h1>
        <p className="text-sm text-ink-700/60">Gate a feature by role and a percentage rollout — evaluated per-user, deterministically</p>
      </div>

      <div className="mb-5">
        <NewFlagForm onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading flags…" />
      ) : flags.length === 0 ? (
        <EmptyState icon={Flag} title="No feature flags" description="Create one above to gate a feature for a role or a percentage of users." />
      ) : (
        <div className="space-y-2.5">
          {flags.map((f) => (
            <Card key={f.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{f.name}</p>
                  <p className="text-xs text-ink-700/50">
                    <code>{f.key}</code> · {f.targetRole === "all" ? "all roles" : f.targetRole}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={f.isEnabled ? "success" : "neutral"}>{f.isEnabled ? "Enabled" : "Disabled"}</Badge>
                  <button onClick={() => remove(f.id)} disabled={busyId === f.id} className="text-danger-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" variant="secondary" onClick={() => toggle(f)} disabled={busyId === f.id}>
                  {f.isEnabled ? "Disable" : "Enable"}
                </Button>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={f.rolloutPct}
                    onChange={(e) => updateRollout(f, Number(e.target.value))}
                    disabled={busyId === f.id}
                    className="flex-1"
                  />
                  <span className="w-12 text-right text-xs font-bold text-ink-700/70">{f.rolloutPct}%</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
