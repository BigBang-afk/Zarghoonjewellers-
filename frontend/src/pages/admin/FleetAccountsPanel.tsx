import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Truck, UserPlus } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import type { FleetAccount, FleetDashboard } from "../../types"

function FleetDetail({ fleet }: { fleet: FleetAccount }) {
  const { push } = useToast()
  const [dashboard, setDashboard] = useState<FleetDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [driverId, setDriverId] = useState("")
  const [busy, setBusy] = useState(false)

  function load() {
    setLoading(true)
    adminApi
      .fleetDashboard(fleet.id)
      .then(setDashboard)
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [fleet.id])

  async function addDriver() {
    if (!driverId.trim()) return
    setBusy(true)
    try {
      await adminApi.assignDriverToFleet(fleet.id, driverId.trim())
      setDriverId("")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeDriver(id: string) {
    setBusy(true)
    try {
      await adminApi.removeDriverFromFleet(fleet.id, id)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading || !dashboard) return <LoadingState label="Loading fleet…" />

  return (
    <div className="border-t border-ink-900/[0.06] p-4 pt-4">
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-ink-900/[0.03] p-3 text-center">
          <p className="font-display text-xl font-extrabold">{dashboard.driverCount}</p>
          <p className="text-[11px] text-ink-700/50">Drivers</p>
        </div>
        <div className="rounded-lg bg-ink-900/[0.03] p-3 text-center">
          <p className="font-display text-xl font-extrabold">{dashboard.totalCompletedRides}</p>
          <p className="text-[11px] text-ink-700/50">Completed rides</p>
        </div>
        <div className="rounded-lg bg-ink-900/[0.03] p-3 text-center">
          <p className="font-display text-xl font-extrabold">{formatMoney(dashboard.totalGrossFareRs, null)}</p>
          <p className="text-[11px] text-ink-700/50">Gross fare</p>
        </div>
      </div>

      {dashboard.drivers.length === 0 ? (
        <p className="text-sm text-ink-700/50">No drivers assigned yet.</p>
      ) : (
        <div className="space-y-1.5">
          {dashboard.drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{d.fullName}</p>
                <p className="text-[11px] text-ink-700/50">{d.completedRides} rides · {formatMoney(d.grossFareRs, null)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={d.availabilityStatus === "online" ? "success" : "neutral"}>{d.availabilityStatus}</Badge>
                <button onClick={() => removeDriver(d.id)} disabled={busy} className="text-[11px] font-bold text-danger-600">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          placeholder="Driver profile ID"
          className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500"
        />
        <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={addDriver} disabled={busy}>Assign</Button>
      </div>
    </div>
  )
}

export function FleetAccountsPanel() {
  const { push } = useToast()
  const [fleets, setFleets] = useState<FleetAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    adminApi
      .fleetAccounts()
      .then((r) => setFleets(r.fleets))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Fleet accounts</h1>
          <p className="text-sm text-ink-700/60">Companies operating multiple drivers under one umbrella</p>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading fleets…" />
      ) : fleets.length === 0 ? (
        <EmptyState icon={Truck} title="No fleet accounts" description="No fleet operators have been created yet." />
      ) : (
        <div className="space-y-3">
          {fleets.map((f) => (
            <Card key={f.id} className="overflow-hidden p-0">
              <button
                onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  {expandedId === f.id ? <ChevronDown className="h-4 w-4 text-ink-700/50" /> : <ChevronRight className="h-4 w-4 text-ink-700/50" />}
                  <div>
                    <p className="text-sm font-bold">{f.companyName}</p>
                    <p className="text-xs text-ink-700/50">
                      {f.city?.name} · {f._count?.drivers ?? 0} drivers · owner {f.owner?.fullName}
                    </p>
                  </div>
                </div>
                <Badge tone={f.isActive ? "success" : "neutral"}>{f.isActive ? "Active" : "Inactive"}</Badge>
              </button>
              {expandedId === f.id && <FleetDetail fleet={f} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
