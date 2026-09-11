import { useEffect, useState } from "react"
import { CheckCircle2, AlertTriangle, XCircle, AlertOctagon, Link as LinkIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Logo } from "../components/Logo"
import { Card } from "../components/ui/Card"
import { Badge } from "../components/ui/Badge"
import { LoadingState, ErrorState } from "../components/ui/States"
import { publicApi } from "../api/public"
import type { PublicSystemStatus, SystemIncident } from "../types"

const OVERALL_META = {
  operational: { label: "All systems operational", icon: CheckCircle2, tone: "text-success-600", bg: "bg-success-500/10" },
  degraded: { label: "Degraded performance", icon: AlertTriangle, tone: "text-gold-700", bg: "bg-gold-400/15" },
  partial_outage: { label: "Partial outage", icon: AlertOctagon, tone: "text-gold-700", bg: "bg-gold-400/15" },
  major_outage: { label: "Major outage", icon: XCircle, tone: "text-danger-600", bg: "bg-danger-500/10" },
} as const

const SEVERITY_TONE = { minor: "warning", major: "warning", critical: "danger" } as const
const STATUS_TONE = { investigating: "danger", identified: "warning", monitoring: "warning", resolved: "success" } as const

function IncidentCard({ incident }: { incident: SystemIncident }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{incident.title}</p>
          <p className="text-xs text-ink-700/50">{incident.affectedArea ?? "Platform-wide"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Badge>
          <Badge tone={STATUS_TONE[incident.status]}>{incident.status}</Badge>
        </div>
      </div>
      <div className="mt-3 space-y-2 border-t border-ink-900/10 pt-3">
        {incident.updates.map((u) => (
          <div key={u.id} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold capitalize">{u.status}</span>
              <span className="text-ink-700/50">{new Date(u.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-0.5 text-ink-700/70">{u.message}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function StatusPage() {
  const [status, setStatus] = useState<PublicSystemStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    publicApi
      .systemStatus()
      .then(setStatus)
      .catch(() => setError("Couldn't load status right now."))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const meta = status ? OVERALL_META[status.overallStatus] : null

  return (
    <div className="min-h-screen bg-[#F6F5FB] text-ink-900">
      <header className="border-b border-ink-900/[0.06] bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link to="/">
            <Logo />
          </Link>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-700/50">System status</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !status || !meta ? (
          <LoadingState label="Checking status…" />
        ) : (
          <>
            <Card className={`flex items-center gap-3 p-5 ${meta.bg}`}>
              <meta.icon className={`h-7 w-7 shrink-0 ${meta.tone}`} />
              <div>
                <p className={`text-lg font-extrabold ${meta.tone}`}>{meta.label}</p>
                <p className="text-xs text-ink-700/50">Last checked {new Date(status.checkedAt).toLocaleTimeString()}</p>
              </div>
            </Card>

            <div className="mt-8">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-700/60">Active incidents</h2>
              {status.openIncidents.length === 0 ? (
                <p className="text-sm text-ink-700/50">No active incidents.</p>
              ) : (
                <div className="space-y-3">
                  {status.openIncidents.map((i) => (
                    <IncidentCard key={i.id} incident={i} />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-8">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-700/60">Recently resolved</h2>
              {status.recentResolvedIncidents.length === 0 ? (
                <p className="text-sm text-ink-700/50">No incidents in recent history.</p>
              ) : (
                <div className="space-y-3">
                  {status.recentResolvedIncidents.map((i) => (
                    <IncidentCard key={i.id} incident={i} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="mt-10 flex items-center justify-center gap-1.5 text-xs text-ink-700/40">
          <LinkIcon className="h-3 w-3" /> This page refreshes automatically every 30 seconds.
        </div>
      </main>
    </div>
  )
}
