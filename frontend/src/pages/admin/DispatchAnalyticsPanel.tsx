import { useEffect, useState } from "react"
import { Route, Target } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { City, DispatchAnalytics } from "../../types"

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "24h", label: "Last 24h", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
]

const STAGE_LABELS: Record<string, string> = {
  closest_eligible: "Closest eligible",
  expand_radius: "Expanded radius",
  expand_pool: "Expanded pool",
  none_available: "No drivers available",
  pending: "Pending / legacy",
}

const REASON_LABELS: Record<string, string> = {
  no_online_drivers_for_vehicle_type: "No online drivers for this vehicle type",
  all_nearby_drivers_stale: "Nearby drivers had stale location data",
  no_drivers_within_max_radius: "No drivers within max search radius",
  dispatch_hop_cap_reached: "Ran out of drivers to escalate to (hop cap)",
  request_expired_no_response: "Request expired without a driver response",
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-700/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-700/50">{hint}</p>}
    </Card>
  )
}

export function DispatchAnalyticsPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [cityId, setCityId] = useState("")
  const [rangeKey, setRangeKey] = useState("7d")
  const [data, setData] = useState<DispatchAnalytics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    adminApi.cities().then((r) => setCities(r.cities))
  }, [])

  useEffect(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 7
    const from = new Date(Date.now() - days * 86_400_000).toISOString()
    setLoading(true)
    adminApi
      .dispatchAnalytics({ from, cityId: cityId || undefined })
      .then(setData)
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, rangeKey])

  const maxStageCount = data ? Math.max(1, ...data.stageBreakdown.map((s) => s.count)) : 1
  const maxReasonCount = data ? Math.max(1, ...data.noMatchReasonBreakdown.map((r) => r.count)) : 1

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Dispatch performance</h1>
          <p className="text-sm text-ink-700/60">Which matching stage found a driver, how long it took, and why requests go unmatched</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex gap-1 rounded-lg bg-ink-900/[0.04] p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${rangeKey === r.key ? "bg-white shadow-rivo-sm" : "text-ink-700/60"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading dispatch analytics…" />
      ) : !data || data.totalRequests === 0 ? (
        <EmptyState icon={Route} title="No ride requests in this window" description="Try a wider date range or a different city." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Requests" value={String(data.totalRequests)} />
            <StatCard label="Match rate" value={`${data.matchRatePct}%`} hint={`${data.matchedCount} matched`} />
            <StatCard
              label="Avg time to match"
              value={data.avgTimeToMatchSec != null ? `${data.avgTimeToMatchSec}s` : "—"}
            />
            <StatCard label="Drivers contacted" value={String(data.avgDriversContactedPerRequest)} hint="avg per request" />
            <StatCard label="Offers received" value={String(data.avgOffersReceivedPerRequest)} hint="avg per request" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-rivo-600" />
                <p className="text-sm font-bold">Dispatch stage reached</p>
              </div>
              {data.stageBreakdown.length === 0 ? (
                <p className="text-sm text-ink-700/50">No dispatch attempts recorded.</p>
              ) : (
                <div className="space-y-2">
                  {data.stageBreakdown.map((s) => (
                    <div key={s.stage} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-xs font-semibold text-ink-700/70">
                        {STAGE_LABELS[s.stage] ?? s.stage}
                      </span>
                      <div className="h-2 flex-1 rounded-full bg-ink-900/[0.06]">
                        <div
                          className="h-2 rounded-full bg-rivo-500"
                          style={{ width: `${Math.max(4, (s.count / maxStageCount) * 100)}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-bold">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Route className="h-4 w-4 text-danger-500" />
                <p className="text-sm font-bold">No-match reasons</p>
              </div>
              {data.noMatchReasonBreakdown.length === 0 ? (
                <p className="text-sm text-ink-700/50">Every request in this window was matched.</p>
              ) : (
                <div className="space-y-2">
                  {data.noMatchReasonBreakdown.map((r) => (
                    <div key={r.reason} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-xs font-semibold text-ink-700/70">
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </span>
                      <div className="h-2 flex-1 rounded-full bg-ink-900/[0.06]">
                        <div
                          className="h-2 rounded-full bg-danger-500"
                          style={{ width: `${Math.max(4, (r.count / maxReasonCount) * 100)}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-bold">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
