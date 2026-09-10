import { useEffect, useState } from "react"
import { Ban, Users } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { CancellationAnalytics, City } from "../../types"

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
]

const REASON_LABELS: Record<string, string> = {
  changed_mind: "Changed mind",
  found_alternative: "Found alternative",
  driver_too_far: "Driver too far",
  driver_not_moving: "Driver not moving",
  wrong_pickup_location: "Wrong pickup location",
  price_too_high: "Price too high",
  long_wait: "Long wait",
  passenger_no_show: "Passenger no-show",
  passenger_unreachable: "Passenger unreachable",
  unsafe_pickup_location: "Unsafe pickup location",
  vehicle_issue: "Vehicle issue",
  wrong_trip_details: "Wrong trip details",
  traffic_or_emergency: "Traffic / emergency",
  other: "Other",
  unspecified: "Unspecified",
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

function ReasonBars({ items }: { items: { reason: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  if (items.length === 0) return <p className="text-sm text-ink-700/50">No cancellations in this window.</p>
  return (
    <div className="space-y-2">
      {items
        .slice()
        .sort((a, b) => b.count - a.count)
        .map((i) => (
          <div key={i.reason} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-xs font-semibold text-ink-700/70">{REASON_LABELS[i.reason] ?? i.reason}</span>
            <div className="h-2 flex-1 rounded-full bg-ink-900/[0.06]">
              <div className="h-2 rounded-full bg-danger-500" style={{ width: `${Math.max(4, (i.count / max) * 100)}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-bold">{i.count}</span>
          </div>
        ))}
    </div>
  )
}

export function CancellationAnalyticsPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [cityId, setCityId] = useState("")
  const [rangeKey, setRangeKey] = useState("30d")
  const [data, setData] = useState<CancellationAnalytics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    adminApi.cities().then((r) => setCities(r.cities))
  }, [])

  useEffect(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30
    const from = new Date(Date.now() - days * 86_400_000).toISOString()
    setLoading(true)
    adminApi
      .cancellationAnalytics({ from, cityId: cityId || undefined })
      .then(setData)
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, rangeKey])

  const totalCancellations = (data?.postMatch.total ?? 0) + (data?.preMatch.total ?? 0)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Cancellation patterns</h1>
          <p className="text-sm text-ink-700/60">Structured reasons from passengers and drivers, and who cancels most</p>
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
        <LoadingState label="Loading cancellation analytics…" />
      ) : !data || totalCancellations === 0 ? (
        <EmptyState icon={Ban} title="No cancellations in this window" description="Try a wider date range or a different city." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Pre-match cancellations" value={String(data.preMatch.total)} hint="passenger, before a driver matched" />
            <StatCard
              label="Post-match cancellations"
              value={String(data.postMatch.total)}
              hint={`${data.postMatch.byPassenger} passenger · ${data.postMatch.byDriver} driver`}
            />
            <StatCard label="Fee charged" value={String(data.postMatch.feeChargedCount)} hint="late-cancellation policy" />
            <StatCard label="Total" value={String(totalCancellations)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold">Pre-match reasons (passenger)</p>
              <ReasonBars items={data.preMatch.byReasonCode} />
            </Card>
            <Card className="p-4">
              <p className="mb-3 text-sm font-bold">Post-match reasons (passenger + driver)</p>
              <ReasonBars items={data.postMatch.byReasonCode} />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-rivo-600" />
                <p className="text-sm font-bold">Passengers cancelling most</p>
              </div>
              {data.topCancellingPassengers.length === 0 ? (
                <p className="text-sm text-ink-700/50">No repeat cancellers.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.topCancellingPassengers.slice(0, 6).map((p) => (
                    <div key={p.userId} className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{p.fullName}</span>
                      <span className="shrink-0 text-xs text-ink-700/60">{p.cancelledRides} cancelled · {p.cancellationRatePct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-rivo-600" />
                <p className="text-sm font-bold">Drivers cancelling most</p>
              </div>
              {data.topCancellingDrivers.length === 0 ? (
                <p className="text-sm text-ink-700/50">No repeat cancellers.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.topCancellingDrivers.slice(0, 6).map((d) => (
                    <div key={d.userId} className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">{d.fullName}</span>
                      <span className="shrink-0 text-xs text-ink-700/60">{d.cancelledRides} cancelled · {d.cancellationRatePct}%</span>
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
