import { useEffect, useState } from "react"
import { AlertTriangle, Plus, Trash2, ExternalLink } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { SystemIncident } from "../../types"

const SEVERITY_TONE = { minor: "warning", major: "warning", critical: "danger" } as const
const STATUS_TONE = { investigating: "danger", identified: "warning", monitoring: "warning", resolved: "success" } as const

function NewIncidentForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useToast()
  const [title, setTitle] = useState("")
  const [affectedArea, setAffectedArea] = useState("")
  const [severity, setSeverity] = useState<"minor" | "major" | "critical">("minor")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function create() {
    if (!title.trim() || !message.trim()) {
      push("error", "Fill in a title and an initial update message.")
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createSystemIncident({ title: title.trim(), affectedArea: affectedArea.trim() || undefined, severity, message: message.trim() })
      push("success", "Incident posted — it's now visible on the public status page.")
      setTitle(""); setAffectedArea(""); setMessage(""); setSeverity("minor")
      onCreated()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold">Post a new incident</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500 sm:col-span-2" />
        <select value={severity} onChange={(e) => setSeverity(e.target.value as "minor" | "major" | "critical")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>
        <input value={affectedArea} onChange={(e) => setAffectedArea(e.target.value)} placeholder="Affected area (e.g. Dispatch)" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500 sm:col-span-3" />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's happening?"
          rows={2}
          className="rounded-lg border border-ink-900/10 px-3 py-2 text-sm outline-none focus:border-rivo-500 sm:col-span-3"
        />
      </div>
      <Button className="mt-3" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={create} disabled={submitting}>
        {submitting ? "Posting…" : "Post incident"}
      </Button>
    </Card>
  )
}

function IncidentRow({ incident, onChanged }: { incident: SystemIncident; onChanged: () => void }) {
  const { push } = useToast()
  const [posting, setPosting] = useState(false)
  const [status, setStatus] = useState<"investigating" | "identified" | "monitoring" | "resolved">("identified")
  const [message, setMessage] = useState("")

  async function postUpdate() {
    if (!message.trim()) {
      push("error", "Enter an update message.")
      return
    }
    setPosting(true)
    try {
      await adminApi.addSystemIncidentUpdate(incident.id, { status, message: message.trim() })
      push("success", "Update posted.")
      setMessage("")
      onChanged()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setPosting(false)
    }
  }

  async function remove() {
    if (!confirm("Delete this incident and its full update history?")) return
    try {
      await adminApi.deleteSystemIncident(incident.id)
      onChanged()
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{incident.title}</p>
          <p className="text-xs text-ink-700/50">{incident.affectedArea ?? "Platform-wide"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Badge>
          <Badge tone={STATUS_TONE[incident.status]}>{incident.status}</Badge>
          <button onClick={remove} className="text-danger-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-ink-900/10 pt-3">
        {incident.updates.map((u) => (
          <div key={u.id} className="text-xs">
            <span className="font-bold capitalize">{u.status}</span>
            <span className="ml-2 text-ink-700/50">{new Date(u.createdAt).toLocaleString()}</span>
            <p className="text-ink-700/70">{u.message}</p>
          </div>
        ))}
      </div>

      {incident.status !== "resolved" && (
        <div className="mt-3 flex flex-col gap-2 border-t border-ink-900/10 pt-3 sm:flex-row">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-9 rounded-lg border border-ink-900/10 px-2.5 text-xs outline-none focus:border-rivo-500">
            <option value="investigating">Investigating</option>
            <option value="identified">Identified</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
          </select>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update message" className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-xs outline-none focus:border-rivo-500" />
          <Button size="sm" onClick={postUpdate} disabled={posting}>
            Post update
          </Button>
        </div>
      )}
    </Card>
  )
}

export function SystemStatusPanel() {
  const { push } = useToast()
  const [incidents, setIncidents] = useState<SystemIncident[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    adminApi
      .systemIncidents()
      .then((r) => setIncidents(r.incidents))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">System status</h1>
          <p className="text-sm text-ink-700/60">Post and update incidents on the public status page.</p>
        </div>
        <a href="#/status" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-bold text-rivo-600">
          View public page <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mb-5">
        <NewIncidentForm onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading incidents…" />
      ) : incidents.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No incidents" description="All clear — post one above if something needs to be communicated." />
      ) : (
        <div className="space-y-2.5">
          {incidents.map((i) => (
            <IncidentRow key={i.id} incident={i} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}
