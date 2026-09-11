import { useEffect, useState } from "react"
import { FlaskConical, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { Experiment, ExperimentResult } from "../../types"

interface VariantDraft {
  key: string
  name: string
  weight: number
}

function NewExperimentForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useToast()
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [targetRole, setTargetRole] = useState<"all" | "passenger" | "driver">("all")
  const [variants, setVariants] = useState<VariantDraft[]>([
    { key: "control", name: "Control", weight: 50 },
    { key: "treatment", name: "Treatment", weight: 50 },
  ])
  const [submitting, setSubmitting] = useState(false)

  const totalWeight = variants.reduce((sum, v) => sum + Number(v.weight || 0), 0)

  function updateVariant(i: number, patch: Partial<VariantDraft>) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }

  function addVariant() {
    setVariants((prev) => [...prev, { key: "", name: "", weight: 0 }])
  }

  function removeVariant(i: number) {
    setVariants((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function create() {
    if (!key.trim() || !name.trim()) {
      push("error", "Fill in a key and name.")
      return
    }
    if (variants.some((v) => !v.key.trim() || !v.name.trim())) {
      push("error", "Every variant needs a key and name.")
      return
    }
    if (totalWeight !== 100) {
      push("error", `Variant weights must sum to 100 (currently ${totalWeight}).`)
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createExperiment({
        key: key.trim().toLowerCase(),
        name: name.trim(),
        targetRole,
        variants: variants.map((v) => ({ key: v.key.trim().toLowerCase(), name: v.name.trim(), weight: Number(v.weight) })),
      })
      push("success", "Experiment created as draft — set it running to start assigning users.")
      setKey(""); setName("")
      setVariants([
        { key: "control", name: "Control", weight: 50 },
        { key: "treatment", name: "Treatment", weight: 50 },
      ])
      onCreated()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold">New experiment</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key (e.g. new_offer_ui)" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as "all" | "passenger" | "driver")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="all">All roles</option>
          <option value="passenger">Passengers only</option>
          <option value="driver">Drivers only</option>
        </select>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs font-bold text-ink-700/60">Variants (weights must sum to 100)</p>
        {variants.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={v.key} onChange={(e) => updateVariant(i, { key: e.target.value })} placeholder="key" className="h-9 w-32 rounded-lg border border-ink-900/10 px-2.5 text-xs outline-none focus:border-rivo-500" />
            <input value={v.name} onChange={(e) => updateVariant(i, { name: e.target.value })} placeholder="Name" className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-xs outline-none focus:border-rivo-500" />
            <input
              type="number"
              min={0}
              max={100}
              value={v.weight}
              onChange={(e) => updateVariant(i, { weight: Number(e.target.value) })}
              className="h-9 w-20 rounded-lg border border-ink-900/10 px-2.5 text-xs outline-none focus:border-rivo-500"
            />
            <span className="text-xs text-ink-700/50">%</span>
            {variants.length > 2 && (
              <button onClick={() => removeVariant(i)} className="text-danger-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button onClick={addVariant} className="flex items-center gap-1 text-xs font-bold text-rivo-600">
            <Plus className="h-3 w-3" /> Add variant
          </button>
          <span className={`text-xs font-bold ${totalWeight === 100 ? "text-success-600" : "text-danger-600"}`}>Total: {totalWeight}%</span>
        </div>
      </div>

      <Button className="mt-3" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={create} disabled={submitting}>
        {submitting ? "Creating…" : "Create experiment"}
      </Button>
    </Card>
  )
}

function ExperimentRow({ experiment, onChanged }: { experiment: Experiment; onChanged: () => void }) {
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [results, setResults] = useState<ExperimentResult[] | null>(null)
  const [totalAssigned, setTotalAssigned] = useState(0)

  async function toggleExpand() {
    if (!expanded && results === null) {
      try {
        const r = await adminApi.experimentDetail(experiment.id)
        setResults(r.results)
        setTotalAssigned(r.totalAssigned)
      } catch (err) {
        push("error", errorMessage(err))
      }
    }
    setExpanded((v) => !v)
  }

  async function setStatus(status: "draft" | "running" | "completed") {
    setBusy(true)
    try {
      await adminApi.updateExperiment(experiment.id, { status })
      push("success", `Experiment set to ${status}.`)
      onChanged()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm("Delete this experiment? All assignment history will be lost.")) return
    setBusy(true)
    try {
      await adminApi.deleteExperiment(experiment.id)
      onChanged()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const tone = experiment.status === "running" ? "success" : experiment.status === "completed" ? "neutral" : "warning"

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{experiment.name}</p>
          <p className="text-xs text-ink-700/50">
            <code>{experiment.key}</code> · {experiment.targetRole === "all" ? "all roles" : experiment.targetRole}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{experiment.status}</Badge>
          <button onClick={toggleExpand} className="text-ink-700/60">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button onClick={remove} disabled={busy} className="text-danger-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {experiment.variants.map((v) => (
          <span key={v.key} className="rounded-full bg-ink-900/5 px-2 py-0.5 text-[11px] font-medium text-ink-700/70">
            {v.name} — {v.weight}%
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {experiment.status === "draft" && (
          <Button size="sm" onClick={() => setStatus("running")} disabled={busy}>
            Start running
          </Button>
        )}
        {experiment.status === "running" && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setStatus("draft")} disabled={busy}>
              Pause (back to draft)
            </Button>
            <Button size="sm" onClick={() => setStatus("completed")} disabled={busy}>
              Mark completed
            </Button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-3 border-t border-ink-900/10 pt-3">
          <p className="mb-2 text-xs font-bold text-ink-700/60">Assignment counts ({totalAssigned} total)</p>
          {results === null ? (
            <LoadingState label="Loading results…" />
          ) : results.length === 0 ? (
            <p className="text-xs text-ink-700/50">No users assigned yet.</p>
          ) : (
            <div className="space-y-1.5">
              {results.map((r) => {
                const pct = totalAssigned > 0 ? Math.round((r.assignedCount / totalAssigned) * 100) : 0
                const variant = experiment.variants.find((v) => v.key === r.variantKey)
                return (
                  <div key={r.variantKey} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate font-medium">{variant?.name ?? r.variantKey}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-900/5">
                      <div className="h-full rounded-full bg-rivo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-20 text-right text-ink-700/60">
                      {r.assignedCount} ({pct}%)
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function ExperimentsPanel() {
  const { push } = useToast()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    adminApi
      .experiments()
      .then((r) => setExperiments(r.experiments))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">A/B tests</h1>
        <p className="text-sm text-ink-700/60">
          Multi-variant experiments with sticky assignment — once a user is bucketed into a variant, they keep seeing it for the life of the
          experiment.
        </p>
      </div>

      <div className="mb-5">
        <NewExperimentForm onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading experiments…" />
      ) : experiments.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No experiments" description="Create one above to start an A/B test." />
      ) : (
        <div className="space-y-2.5">
          {experiments.map((e) => (
            <ExperimentRow key={e.id} experiment={e} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}
