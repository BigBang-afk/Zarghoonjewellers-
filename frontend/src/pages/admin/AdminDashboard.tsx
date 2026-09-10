import { useEffect, useState } from "react"
import {
  AlertTriangle,
  Banknote,
  Bell,
  Car,
  CheckCircle2,
  ClipboardList,
  FileClock,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  MapPinned,
  Percent,
  Route,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sliders,
  Tag,
  Users,
  Wallet,
  Building2,
  ScrollText,
  UserCog,
  BarChart3,
  FileBarChart,
  TrendingUp,
} from "lucide-react"
import { Logo } from "../../components/Logo"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { LoadingState, ErrorState } from "../../components/ui/States"
import { MapCanvas, CarMarker } from "../../components/ui/MapCanvas"
import { adminApi } from "../../api/admin"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney, getCurrencyMeta } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { AdminKpis, City } from "../../types"
import { DriverVerificationPanel } from "./DriverVerificationPanel"
import { DirectoryPanel } from "./DirectoryPanel"
import { DriverAcquisitionPanel } from "./DriverAcquisitionPanel"

const nav = [
  {
    group: "Overview",
    items: [
      { label: "Dashboard", icon: LayoutGrid },
      { label: "Live Map", icon: MapPinned },
    ],
  },
  {
    group: "Operations",
    items: [
      { label: "Passengers", icon: Users },
      { label: "Drivers", icon: Car },
      { label: "Driver Verification", icon: ShieldAlert },
      { label: "Driver Acquisition", icon: TrendingUp },
      { label: "Vehicles", icon: Car },
      { label: "Ride Requests", icon: ClipboardList },
      { label: "Active Rides", icon: Route },
      { label: "Completed Rides", icon: CheckCircle2 },
      { label: "Cancelled Rides", icon: FileClock },
    ],
  },
  {
    group: "Finance",
    items: [
      { label: "Payments", icon: Wallet },
      { label: "Commissions", icon: Percent },
      { label: "Promotions", icon: Tag },
    ],
  },
  {
    group: "Trust & Safety",
    items: [
      { label: "Support", icon: LifeBuoy },
      { label: "Disputes", icon: AlertTriangle },
      { label: "Safety", icon: Shield },
      { label: "Fraud / Risk", icon: ShieldAlert },
    ],
  },
  {
    group: "Configuration",
    items: [
      { label: "Cities", icon: Building2 },
      { label: "Service Areas", icon: MapPinned },
      { label: "Pricing", icon: Sliders },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Analytics", icon: BarChart3 },
      { label: "Reports", icon: FileBarChart },
      { label: "Notifications", icon: Bell },
      { label: "Admin Users", icon: UserCog },
      { label: "Settings", icon: Settings },
      { label: "Audit Logs", icon: ScrollText },
    ],
  },
]

const FULLY_WIRED = new Set(["Dashboard", "Driver Verification", "Driver Acquisition", "Passengers", "Drivers", "Ride Requests"])

export function AdminDashboard() {
  const { user } = useAuth()
  const { push } = useToast()
  const { locale } = useLocale()
  const [active, setActive] = useState("Dashboard")
  const [kpis, setKpis] = useState<AdminKpis | null>(null)
  const [cities, setCities] = useState<(City & { _count: { driverProfiles: number; serviceZones: number } })[]>([])
  const [mapDrivers, setMapDrivers] = useState<{ id: string; status: string; lat: number; lng: number }[]>([])
  const [liveOps, setLiveOps] = useState<Awaited<ReturnType<typeof adminApi.liveOpsSummary>> | null>(null)
  const [supply, setSupply] = useState<Awaited<ReturnType<typeof adminApi.supplyDashboard>> | null>(null)
  const [error, setError] = useState(false)

  async function loadDashboard() {
    setError(false)
    try {
      const [k, c, m, ops, sup] = await Promise.all([
        adminApi.kpis(),
        adminApi.cities(),
        adminApi.liveMap(),
        adminApi.liveOpsSummary(),
        adminApi.supplyDashboard(),
      ])
      setKpis(k)
      setCities(c.cities)
      setMapDrivers(m.drivers)
      setLiveOps(ops)
      setSupply(sup)
    } catch (err) {
      setError(true)
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    if (active === "Dashboard") loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div className="flex min-h-[calc(100vh-41px)] bg-[#F3F2F9] text-ink-900">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-900/[0.06] bg-ink-900 text-white md:flex">
        <div className="flex h-16 items-center px-5">
          <Logo tone="light" />
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-none">
          {nav.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/35">{g.group}</p>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setActive(item.label)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                      active === item.label ? "bg-white text-ink-900" : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.label === "Driver Verification" && kpis && kpis.pendingDriverVerifications > 0 ? (
                      <span className="rounded-full bg-gold-400 px-1.5 py-0.5 text-[10px] font-bold text-ink-900">{kpis.pendingDriverVerifications}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-4 border-b border-ink-900/[0.06] bg-white px-4 md:px-6">
          <div className="md:hidden"><Logo /></div>
          <div className="hidden max-w-md flex-1 items-center gap-2 rounded-xl bg-ink-900/[0.04] px-3 py-2 md:flex">
            <Search className="h-4 w-4 text-ink-700/50" />
            <input placeholder="Search rides, drivers, passengers…" className="w-full bg-transparent text-sm outline-none placeholder:text-ink-700/40" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge tone="success" dot className="hidden sm:inline-flex">{cities.find((c) => c.status === "live")?.name ?? "RIVO"} · Live</Badge>
            <button className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
              <Bell className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rivo-600 text-xs font-bold text-white">
              {user?.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {active === "Driver Verification" ? (
            <DriverVerificationPanel />
          ) : active === "Driver Acquisition" ? (
            <DriverAcquisitionPanel />
          ) : active === "Passengers" ? (
            <DirectoryPanel kind="passengers" />
          ) : active === "Drivers" ? (
            <DirectoryPanel kind="drivers" />
          ) : active === "Ride Requests" ? (
            <DirectoryPanel kind="ride-requests" />
          ) : active !== "Dashboard" ? (
            <PlaceholderSection label={active} />
          ) : error ? (
            <ErrorState message="Couldn't load the dashboard. Is the backend running?" onRetry={loadDashboard} />
          ) : !kpis ? (
            <LoadingState label="Loading live data…" />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold tracking-tight">Operations overview</h1>
                  <p className="text-sm text-ink-700/60">Live from the database — no placeholder numbers</p>
                </div>
                {kpis.pendingDriverVerifications > 0 && (
                  <button onClick={() => setActive("Driver Verification")}>
                    <Badge tone="warning" dot>{kpis.pendingDriverVerifications} drivers awaiting verification</Badge>
                  </button>
                )}
              </div>

              {liveOps && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    { label: `${liveOps.openSafetyIncidents} open safety incidents`, tone: liveOps.openSafetyIncidents > 0 ? "danger" : "neutral" },
                    { label: `${liveOps.openDisputes} open disputes`, tone: liveOps.openDisputes > 0 ? "warning" : "neutral" },
                    { label: `${liveOps.openSupportTickets} open tickets`, tone: liveOps.openSupportTickets > 0 ? "warning" : "neutral" },
                    { label: `${liveOps.staleLocationDrivers} stale-location drivers`, tone: liveOps.staleLocationDrivers > 0 ? "warning" : "neutral" },
                    { label: `${liveOps.cancellationsInWindow} cancellations (24h)`, tone: "neutral" },
                  ].map((b) => (
                    <Badge key={b.label} tone={b.tone as "danger" | "warning" | "neutral"} dot>
                      {b.label}
                    </Badge>
                  ))}
                </div>
              )}

              {supply && supply.alerts.length > 0 && (
                <div className="mb-4 space-y-1.5">
                  {supply.alerts.map((a, i) => (
                    <div key={i} className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-3.5 py-2.5 text-xs font-semibold text-ink-900">
                      {a}
                    </div>
                  ))}
                </div>
              )}

              {supply && (
                <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    { label: "Online", value: supply.onlineDrivers },
                    { label: "Available", value: supply.availableDrivers },
                    { label: "Busy", value: supply.busyDrivers },
                    { label: "Offline", value: supply.offlineDrivers },
                    { label: "Stale GPS", value: supply.staleGpsDrivers },
                    { label: "Open requests", value: supply.openRequestsCount },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-white px-3 py-2.5 text-center shadow-rivo-sm">
                      <p className="text-lg font-extrabold">{s.value}</p>
                      <p className="text-[10px] uppercase tracking-wide text-ink-700/50">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { label: "Rides today", value: kpis.ridesRequestedToday, icon: Route },
                  { label: "Active rides", value: kpis.activeRides, icon: Gauge },
                  { label: "Online drivers", value: kpis.onlineDrivers, icon: Car },
                  {
                    label: "Gross booking value",
                    value: kpis.currencyCode
                      ? `${getCurrencyMeta(kpis.currencyCode).symbol} ${(kpis.grossBookingValueRs / 1000).toFixed(1)}k`
                      : `${(kpis.grossBookingValueRs / 1000).toFixed(1)}k (mixed currencies)`,
                    icon: Wallet,
                  },
                  { label: "Platform revenue", value: formatMoney(kpis.platformRevenueRs, kpis.currencyCode, locale), icon: Banknote },
                  { label: "Avg. fare", value: formatMoney(kpis.avgFareRs, kpis.currencyCode, locale), icon: Tag },
                  { label: "Completed today", value: kpis.completedToday, icon: CheckCircle2 },
                  { label: "Repeat passengers", value: `${kpis.repeatPassengerRatePct}%`, icon: Users },
                ].map((k) => (
                  <Card key={k.label} className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-700/60">{k.label}</span>
                      <k.icon className="h-4 w-4 text-ink-700/40" />
                    </div>
                    <p className="mt-2 font-display text-2xl font-extrabold">{k.value}</p>
                  </Card>
                ))}
              </div>

              <Card className="mt-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
                {[
                  { label: "Total passengers", value: kpis.totalPassengers },
                  { label: "Total drivers", value: kpis.totalDrivers },
                  { label: "Cancelled today", value: kpis.cancelledToday },
                  { label: "Driver earnings", value: formatMoney(kpis.driverEarningsRs, kpis.currencyCode, locale) },
                  { label: "Driver cancellation", value: `${kpis.driverCancellationRatePct}%` },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-sm font-extrabold">{s.value}</p>
                    <p className="text-[11px] text-ink-700/55">{s.label}</p>
                  </div>
                ))}
              </Card>

              <div className="mt-5 grid gap-4 lg:grid-cols-5">
                <Card className="overflow-hidden p-0 lg:col-span-3">
                  <div className="flex items-center justify-between p-4 pb-0">
                    <h2 className="font-display text-base font-bold">Live map</h2>
                    <div className="flex items-center gap-3 text-[11px] text-ink-700/60">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success-500" /> Online</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rivo-500" /> On trip</span>
                    </div>
                  </div>
                  <MapCanvas className="mt-3 h-72">
                    {mapDrivers.slice(0, 40).map((d, i) => (
                      <span key={d.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${18 + ((i * 37) % 64)}%`, top: `${18 + ((i * 53) % 64)}%` }}>
                        <span className={`block h-3 w-3 rounded-full ring-2 ring-white ${d.status === "online" ? "bg-success-500" : "bg-rivo-500"}`} />
                      </span>
                    ))}
                    <CarMarker x={55} y={50} rotate={12} />
                  </MapCanvas>
                </Card>

                <Card className="p-4 lg:col-span-2">
                  <h2 className="font-display text-base font-bold">Cities</h2>
                  <div className="mt-3 space-y-2">
                    {cities.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl bg-ink-900/[0.03] px-3 py-2.5">
                        <div>
                          <p className="text-sm font-bold">{c.name}</p>
                          <p className="text-[11px] text-ink-700/55">{c._count.serviceZones} zones</p>
                        </div>
                        <div className="text-right">
                          <Badge tone={c.status === "live" ? "success" : c.status === "launching" ? "warning" : "neutral"}>{c.status}</Badge>
                          <p className="mt-1 text-[11px] text-ink-700/55">{c._count.driverProfiles.toLocaleString(locale)} drivers</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PlaceholderSection({ label }: { label: string }) {
  const wired = FULLY_WIRED.has(label)
  return (
    <Card className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rivo-600/10 text-rivo-600">
        <LayoutGrid className="h-6 w-6" />
      </div>
      <h2 className="font-display text-xl font-bold">{label}</h2>
      <p className="max-w-sm text-sm text-ink-700/60">
        {wired
          ? "Loading…"
          : "This workspace is part of the RIVO admin architecture and reads from the real database via the same API pattern as Dashboard, Driver Verification, Passengers, and Drivers — its full interface is scoped for a later phase."}
      </p>
    </Card>
  )
}
