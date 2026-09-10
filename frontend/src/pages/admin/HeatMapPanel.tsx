import { useEffect, useState } from "react"
import { Flame } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { City, DemandMap, ServiceZone } from "../../types"

const RANGES: { key: string; label: string }[] = [
  { key: "last15min", label: "Last 15 min" },
  { key: "lastHour", label: "Last hour" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7days", label: "Last 7 days" },
]

const STATUS_COLOR: Record<string, string> = {
  green: "bg-success-500",
  yellow: "bg-warning-500",
  red: "bg-danger-500",
}

export function HeatMapPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [cityId, setCityId] = useState("")
  const [zones, setZones] = useState<ServiceZone[]>([])
  const [zoneId, setZoneId] = useState("")
  const [range, setRange] = useState("lastHour")
  const [map, setMap] = useState<DemandMap | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    adminApi.cities().then((r) => {
      setCities(r.cities)
      if (r.cities[0]) setCityId(r.cities[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!cityId) return
    setZoneId("")
    adminApi.serviceZones(cityId).then((r) => setZones(r.zones)).catch(() => setZones([]))
  }, [cityId])

  useEffect(() => {
    if (!cityId) return
    setLoading(true)
    adminApi
      .demandMap({ cityId, zoneId: zoneId || undefined, range })
      .then(setMap)
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, zoneId, range])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Demand heat map</h1>
          <p className="text-sm text-ink-700/60">Open requests vs. online drivers, gridded across each city's active area</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <div className="flex gap-1 rounded-lg bg-ink-900/[0.04] p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${range === r.key ? "bg-white shadow-rivo-sm" : "text-ink-700/60"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-rivo-600" />
            <p className="text-sm font-bold">Demand grid</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-ink-700/60">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success-500" /> Healthy</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Caution</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Undersupplied</span>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading heat map…" />
        ) : !map || map.cells.length === 0 ? (
          <EmptyState icon={Flame} title="No activity" description="No online drivers, open requests, or recent rides in this window." />
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${map.gridSize}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: map.gridSize * map.gridSize }).map((_, i) => {
              const row = Math.floor(i / map.gridSize)
              const col = i % map.gridSize
              const cell = map.cells.find((c) => c.row === row && c.col === col)
              if (!cell) return <div key={i} className="aspect-square rounded-lg bg-ink-900/[0.03]" />
              return (
                <div
                  key={i}
                  title={`${cell.onlineDrivers} drivers · ${cell.openRequests} open requests · ratio ${cell.demandRatio}`}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg text-white ${STATUS_COLOR[cell.status]}`}
                >
                  <span className="text-xs font-extrabold">{cell.openRequests}</span>
                  <span className="text-[9px] opacity-80">{cell.onlineDrivers} drv</span>
                </div>
              )
            })}
          </div>
        )}

        {map?.thresholds && (
          <p className="mt-3 text-[11px] text-ink-700/45">
            Thresholds: ratio ≤ {map.thresholds.greenMaxRatio} healthy, ≤ {map.thresholds.yellowMaxRatio} caution, above that undersupplied — configurable in Settings.
          </p>
        )}
      </Card>
    </div>
  )
}
