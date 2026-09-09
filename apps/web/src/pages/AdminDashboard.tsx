import { useState } from "react"
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
} from "lucide-react"
import { Logo } from "../components/Logo"
import { Card } from "../components/ui/Card"
import { Badge } from "../components/ui/Badge"
import { MapCanvas, CarMarker } from "../components/ui/MapCanvas"
import {
  adminCities,
  adminKpis,
  adminMapDrivers,
  adminPendingVerifications,
  adminRecentRides,
  currentCity,
} from "../data/mock"

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
      { label: "Driver Verification", icon: ShieldAlert, badge: adminPendingVerifications },
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

const statusTone = { completed: "success", in_progress: "brand", requested: "warning", cancelled: "danger" } as const
const statusLabel = { completed: "Completed", in_progress: "In progress", requested: "Requested", cancelled: "Cancelled" } as const

const kpiCards = [
  { label: "Rides today", value: adminKpis.ridesToday.toLocaleString(), icon: Route, tone: "brand" as const },
  { label: "Active rides", value: adminKpis.activeRides.toLocaleString(), icon: Gauge, tone: "success" as const },
  { label: "Online drivers", value: adminKpis.onlineDrivers.toLocaleString(), icon: Car, tone: "brand" as const },
  { label: "Gross booking value", value: `Rs ${(adminKpis.grossBookingValueRs / 1_000_000).toFixed(2)}M`, icon: Wallet, tone: "warning" as const },
  { label: "Platform revenue", value: `Rs ${(adminKpis.platformRevenueRs / 1000).toFixed(0)}k`, icon: Banknote, tone: "success" as const },
  { label: "Avg. fare", value: `Rs ${adminKpis.avgFareRs}`, icon: Tag, tone: "brand" as const },
  { label: "Avg. ETA", value: `${adminKpis.avgEtaMin} min`, icon: Gauge, tone: "brand" as const },
  { label: "Driver acceptance", value: `${adminKpis.driverAcceptanceRate}%`, icon: CheckCircle2, tone: "success" as const },
]

const secondaryStats = [
  { label: "Total passengers", value: adminKpis.totalPassengers.toLocaleString() },
  { label: "Active passengers", value: adminKpis.activePassengers.toLocaleString() },
  { label: "Total drivers", value: adminKpis.totalDrivers.toLocaleString() },
  { label: "Completed today", value: adminKpis.completedToday.toLocaleString() },
  { label: "Cancelled today", value: adminKpis.cancelledToday.toLocaleString() },
  { label: "Driver earnings", value: `Rs ${(adminKpis.driverEarningsRs / 1_000_000).toFixed(2)}M` },
  { label: "Avg. duration", value: `${adminKpis.avgDurationMin} min` },
  { label: "Driver cancellation", value: `${adminKpis.driverCancellationRate}%` },
  { label: "Passenger cancellation", value: `${adminKpis.passengerCancellationRate}%` },
  { label: "Repeat passenger rate", value: `${adminKpis.repeatPassengerRate}%` },
]

const driverStatusDot = { online: "bg-success-500", on_trip: "bg-rivo-500", offline_pending: "bg-ink-500" }

export function AdminDashboard() {
  const [active, setActive] = useState("Dashboard")

  return (
    <div className="flex min-h-[calc(100vh-41px)] bg-[#F3F2F9] text-ink-900">
      {/* Sidebar */}
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
                    {"badge" in item && item.badge ? (
                      <span className="rounded-full bg-gold-400 px-1.5 py-0.5 text-[10px] font-bold text-ink-900">{item.badge}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <div className="flex h-16 items-center gap-4 border-b border-ink-900/[0.06] bg-white px-4 md:px-6">
          <div className="md:hidden"><Logo /></div>
          <div className="hidden flex-1 items-center gap-2 rounded-xl bg-ink-900/[0.04] px-3 py-2 md:flex max-w-md">
            <Search className="h-4 w-4 text-ink-700/50" />
            <input placeholder="Search rides, drivers, passengers…" className="w-full bg-transparent text-sm outline-none placeholder:text-ink-700/40" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge tone="success" dot className="hidden sm:inline-flex">{currentCity.name} · Live</Badge>
            <button className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger-500" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rivo-600 text-xs font-bold text-white">OM</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {active !== "Dashboard" ? (
            <PlaceholderSection label={active} />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold tracking-tight">Operations overview</h1>
                  <p className="text-sm text-ink-700/60">Real-time snapshot across {currentCity.name} · demo data</p>
                </div>
                {adminPendingVerifications > 0 && (
                  <Badge tone="warning" dot>{adminPendingVerifications} drivers awaiting verification</Badge>
                )}
              </div>

              {/* KPI grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {kpiCards.map((k) => (
                  <Card key={k.label} className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-700/60">{k.label}</span>
                      <k.icon className="h-4 w-4 text-ink-700/40" />
                    </div>
                    <p className="mt-2 font-display text-2xl font-extrabold">{k.value}</p>
                  </Card>
                ))}
              </div>

              {/* secondary stats strip */}
              <Card className="mt-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
                {secondaryStats.map((s) => (
                  <div key={s.label}>
                    <p className="text-sm font-extrabold">{s.value}</p>
                    <p className="text-[11px] text-ink-700/55">{s.label}</p>
                  </div>
                ))}
              </Card>

              <div className="mt-5 grid gap-4 lg:grid-cols-5">
                {/* Live map */}
                <Card className="overflow-hidden p-0 lg:col-span-3">
                  <div className="flex items-center justify-between p-4 pb-0">
                    <h2 className="font-display text-base font-bold">Live map</h2>
                    <div className="flex items-center gap-3 text-[11px] text-ink-700/60">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success-500" /> Online</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rivo-500" /> On trip</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ink-500" /> Pending</span>
                    </div>
                  </div>
                  <MapCanvas className="mt-3 h-72">
                    {adminMapDrivers.map((d) => (
                      <span key={d.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${d.x}%`, top: `${d.y}%` }}>
                        <span className={`block h-3 w-3 rounded-full ring-2 ring-white ${driverStatusDot[d.status]}`} />
                      </span>
                    ))}
                    <CarMarker x={55} y={50} rotate={12} />
                  </MapCanvas>
                </Card>

                {/* Cities */}
                <Card className="p-4 lg:col-span-2">
                  <h2 className="font-display text-base font-bold">Cities</h2>
                  <div className="mt-3 space-y-2">
                    {adminCities.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl bg-ink-900/[0.03] px-3 py-2.5">
                        <div>
                          <p className="text-sm font-bold">{c.name}</p>
                          <p className="text-[11px] text-ink-700/55">{c.country} · {c.zones} zones</p>
                        </div>
                        <div className="text-right">
                          <Badge tone={c.status === "live" ? "success" : c.status === "launching" ? "warning" : "neutral"}>
                            {c.status === "live" ? "Live" : c.status === "launching" ? "Launching" : "Planned"}
                          </Badge>
                          <p className="mt-1 text-[11px] text-ink-700/55">{c.drivers.toLocaleString()} drivers</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Recent rides table */}
              <Card className="mt-4 overflow-hidden p-0">
                <div className="flex items-center justify-between p-4 pb-3">
                  <h2 className="font-display text-base font-bold">Recent ride requests</h2>
                  <button className="text-xs font-semibold text-rivo-600">View all</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-y border-ink-900/[0.06] text-[11px] uppercase tracking-wide text-ink-700/50">
                        <th className="px-4 py-2 font-semibold">Ride ID</th>
                        <th className="px-4 py-2 font-semibold">Passenger</th>
                        <th className="px-4 py-2 font-semibold">Driver</th>
                        <th className="px-4 py-2 font-semibold">Vehicle</th>
                        <th className="px-4 py-2 font-semibold">Mode</th>
                        <th className="px-4 py-2 font-semibold">Fare</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminRecentRides.map((r) => (
                        <tr key={r.id} className="border-b border-ink-900/[0.05] last:border-0">
                          <td className="px-4 py-3 font-mono text-xs text-ink-700/70">{r.id}</td>
                          <td className="px-4 py-3 font-medium">{r.passenger}</td>
                          <td className="px-4 py-3 text-ink-700/70">{r.driver}</td>
                          <td className="px-4 py-3 text-ink-700/70">{r.vehicle}</td>
                          <td className="px-4 py-3">
                            <Badge tone={r.mode === "Quick Match" ? "brand" : "warning"}>{r.mode}</Badge>
                          </td>
                          <td className="px-4 py-3 font-semibold">Rs {r.fareRs}</td>
                          <td className="px-4 py-3">
                            <Badge tone={statusTone[r.status]} dot>{statusLabel[r.status]}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PlaceholderSection({ label }: { label: string }) {
  return (
    <Card className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rivo-600/10 text-rivo-600">
        <LayoutGrid className="h-6 w-6" />
      </div>
      <h2 className="font-display text-xl font-bold">{label}</h2>
      <p className="max-w-sm text-sm text-ink-700/60">
        This workspace is part of the RIVO admin architecture. Its full interface builds out in a later phase —
        Phase 1 focuses on the operations Dashboard, shown as the default view.
      </p>
    </Card>
  )
}
