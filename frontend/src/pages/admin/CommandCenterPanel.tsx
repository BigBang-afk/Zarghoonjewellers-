import { useEffect, useState } from "react"
import { Crown, TrendingUp, Users, LineChart, Layers } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { LoadingState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import type { AcquisitionAnalytics, City, CohortAnalytics, ExecutiveDashboard, UnitEconomics, UnitEconomicsMetric } from "../../types"

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
]

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-700/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-700/50">{hint}</p>}
    </Card>
  )
}

function MetricRow({ label, metric, sign = "" }: { label: string; metric: UnitEconomicsMetric; sign?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-900/[0.05] py-2 text-sm last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-ink-700/70">{label}</span>
        {metric.basis === "estimate" && (
          <span title={metric.note} className="cursor-help">
            <Badge tone="warning">estimate</Badge>
          </span>
        )}
      </div>
      <span className="font-bold">
        {sign}
        {formatMoney(Math.abs(metric.value), null)}
      </span>
    </div>
  )
}

export function CommandCenterPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [cityId, setCityId] = useState("")
  const [rangeKey, setRangeKey] = useState("30d")
  const [exec, setExec] = useState<ExecutiveDashboard | null>(null)
  const [unitEcon, setUnitEcon] = useState<UnitEconomics | null>(null)
  const [acquisition, setAcquisition] = useState<AcquisitionAnalytics | null>(null)
  const [cohorts, setCohorts] = useState<CohortAnalytics | null>(null)
  const [cohortRole, setCohortRole] = useState<"passenger" | "driver">("passenger")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.cities().then((r) => setCities(r.cities))
  }, [])

  useEffect(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30
    const from = new Date(Date.now() - days * 86_400_000).toISOString()
    setLoading(true)
    Promise.all([
      adminApi.executiveDashboard({ from, cityId: cityId || undefined }),
      adminApi.unitEconomics({ from, cityId: cityId || undefined }),
      adminApi.acquisitionAnalytics({ cityId: cityId || undefined }),
    ])
      .then(([e, u, a]) => {
        setExec(e)
        setUnitEcon(u)
        setAcquisition(a)
      })
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, rangeKey])

  useEffect(() => {
    adminApi.cohortAnalytics({ role: cohortRole, weeks: 8 }).then(setCohorts).catch((err) => push("error", errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortRole])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
            <Crown className="h-6 w-6 text-gold-500" /> Command center
          </h1>
          <p className="text-sm text-ink-700/60">The one-screen view of platform health, unit economics, and growth — every figure computed from real rows.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
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
      </div>

      {loading || !exec || !unitEcon || !acquisition ? (
        <LoadingState label="Loading command center…" />
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Executive summary</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Gross booking value" value={formatMoney(exec.grossBookingValueRs, null)} />
              <Stat label="Platform revenue" value={formatMoney(exec.platformRevenueRs, null)} />
              <Stat label="Completed rides" value={String(exec.completedRides)} hint={`${exec.completionRatePct}% completion`} />
              <Stat label="Cancellation rate" value={`${exec.cancellationRatePct}%`} />
              <Stat label="Avg fare" value={formatMoney(exec.avgFareRs, null)} />
              <Stat label="Active passengers" value={String(exec.activePassengers)} hint={`${exec.repeatRatePct}% repeat rate`} />
              <Stat label="Active drivers" value={String(exec.activeDrivers)} hint={exec.driverRetentionPct != null ? `${exec.driverRetentionPct}% retained` : undefined} />
              <Stat label="Avg driver ETA" value={`${exec.avgDriverEtaMin} min`} />
              <Stat label="Supply/demand ratio" value={exec.supplyDemandRatio != null ? exec.supplyDemandRatio.toFixed(2) : "—"} />
              <Stat label="Support tickets" value={String(exec.supportTicketsCount)} hint={`${formatMoney(exec.refundsRs, null)} refunded`} />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Layers className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Unit economics — per completed ride</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <MetricRow label="Revenue (commission)" metric={unitEcon.perRide.revenuePerRideRs} sign="+" />
                <MetricRow label="Driver payout" metric={unitEcon.perRide.driverPayoutPerRideRs} sign="−" />
                <MetricRow label="Payment processing cost" metric={unitEcon.perRide.paymentProcessingCostPerRideRs} sign="−" />
                <MetricRow label="Promotion cost" metric={unitEcon.perRide.promotionCostPerRideRs} sign="−" />
                <MetricRow label="Refunds" metric={unitEcon.perRide.refundsPerRideRs} sign="−" />
                <div className="mt-2 flex items-center justify-between pt-2">
                  <span className="text-sm font-bold">Contribution margin / ride</span>
                  <span className={`font-display text-lg font-extrabold ${unitEcon.perRide.contributionMarginPerRideRs.value >= 0 ? "text-success-600" : "text-danger-600"}`}>
                    {formatMoney(unitEcon.perRide.contributionMarginPerRideRs.value, null)}
                  </span>
                </div>
              </Card>
              <Card className="p-4">
                <p className="mb-3 text-sm font-bold">Totals for this window ({unitEcon.completedRides} rides)</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-ink-700/50">Gross booking value</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.grossBookingValueRs, null)}</p>
                  </div>
                  <div>
                    <p className="text-ink-700/50">Platform revenue</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.platformRevenueRs, null)}</p>
                  </div>
                  <div>
                    <p className="text-ink-700/50">Driver payouts</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.driverPayoutsRs, null)}</p>
                  </div>
                  <div>
                    <p className="text-ink-700/50">Promotion cost</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.promotionCostRs, null)}</p>
                  </div>
                  <div>
                    <p className="text-ink-700/50">Refunds</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.refundsRs, null)}</p>
                  </div>
                  <div>
                    <p className="text-ink-700/50">Est. processing cost</p>
                    <p className="font-bold">{formatMoney(unitEcon.totals.estimatedPaymentProcessingCostRs, null)}</p>
                  </div>
                </div>
              </Card>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Acquisition by source</p>
            </div>
            <Card className="overflow-x-auto p-4">
              {acquisition.bySource.length === 0 ? (
                <p className="text-sm text-ink-700/50">No sign-ups yet.</p>
              ) : (
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-ink-900/10 text-left text-xs font-bold uppercase tracking-wide text-ink-700/50">
                      <th className="pb-2">Source</th>
                      <th className="pb-2 text-right">Sign-ups</th>
                      <th className="pb-2 text-right">1st ride rate</th>
                      <th className="pb-2 text-right">Repeat rate</th>
                      <th className="pb-2 text-right">Retained</th>
                      <th className="pb-2 text-right">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acquisition.bySource.map((b) => (
                      <tr key={b.key} className="border-b border-ink-900/[0.05] last:border-0">
                        <td className="py-2 font-medium capitalize">{b.key.replace(/_/g, " ")}</td>
                        <td className="py-2 text-right">{b.signups}</td>
                        <td className="py-2 text-right">{b.firstRideRatePct}%</td>
                        <td className="py-2 text-right">{b.repeatRideRatePct}%</td>
                        <td className="py-2 text-right">{b.retainedPct}%</td>
                        <td className="py-2 text-right">{b.cpaRs != null ? formatMoney(b.cpaRs, null) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LineChart className="h-4 w-4 text-rivo-600" />
                <p className="text-sm font-bold">Weekly retention cohorts</p>
              </div>
              <div className="flex gap-1 rounded-lg bg-ink-900/[0.04] p-1">
                {(["passenger", "driver"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setCohortRole(r)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-bold capitalize transition-colors ${cohortRole === r ? "bg-white shadow-rivo-sm" : "text-ink-700/60"}`}
                  >
                    {r}s
                  </button>
                ))}
              </div>
            </div>
            <Card className="overflow-x-auto p-4">
              {!cohorts || cohorts.cohorts.length === 0 ? (
                <p className="text-sm text-ink-700/50">No {cohortRole} registrations in the last 8 weeks.</p>
              ) : (
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-ink-900/10 text-left text-xs font-bold uppercase tracking-wide text-ink-700/50">
                      <th className="pb-2">Cohort week</th>
                      <th className="pb-2 text-right">Registered</th>
                      <th className="pb-2 text-right">1st ride rate</th>
                      <th className="pb-2 text-right">Returned 7d</th>
                      <th className="pb-2 text-right">Returned 30d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.cohorts.map((c) => (
                      <tr key={c.week} className="border-b border-ink-900/[0.05] last:border-0">
                        <td className="py-2 font-medium">{c.week}</td>
                        <td className="py-2 text-right">{c.registered}</td>
                        <td className="py-2 text-right">{c.firstRideRatePct}%</td>
                        <td className="py-2 text-right">{c.returned7dPct}%</td>
                        <td className="py-2 text-right">{c.returned30dPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>
      )}
    </div>
  )
}
