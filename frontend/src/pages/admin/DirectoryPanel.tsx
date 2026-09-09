import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { EmptyState, LoadingState } from "../../components/ui/States"
import { api } from "../../api/client"
import { useToast, errorMessage } from "../../shared/Toast"

interface PassengerRow {
  id: string
  fullName: string
  phone: string
  email: string | null
  status: string
  passengerProfile: { completedRides: number; ratingAvg: number } | null
}
interface DriverRow {
  id: string
  fullName: string
  phone: string
  status: string
  driverProfile: { verificationStatus: string; availabilityStatus: string; ratingAvg: number; completedRides: number; city: { name: string } } | null
}
interface RideRequestRow {
  id: string
  status: string
  bookingMode: string
  proposedFare: number
  passenger: { user: { fullName: string } }
  pickup: { address: string }
  destination: { address: string }
  createdAt: string
}

const statusTone: Record<string, "success" | "warning" | "danger" | "brand" | "neutral"> = {
  active: "success", approved: "success", online: "success",
  pending: "warning", pending_verification: "warning", offers_open: "warning", searching: "brand",
  matched: "brand", on_trip: "brand",
  suspended: "danger", banned: "danger", rejected: "danger", cancelled: "danger", expired: "danger",
  offline: "neutral",
}

export function DirectoryPanel({ kind }: { kind: "passengers" | "drivers" | "ride-requests" }) {
  const [rows, setRows] = useState<unknown[] | null>(null)
  const [search, setSearch] = useState("")
  const { push } = useToast()

  useEffect(() => {
    const key = kind === "passengers" ? "passengers" : kind === "drivers" ? "drivers" : "requests"
    api
      .get<Record<string, unknown[]>>(`/admin/${kind}`, search ? { search, pageSize: 30 } : { pageSize: 30 })
      .then((res) => setRows(res[key]))
      .catch((err) => push("error", errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search])

  const title = kind === "passengers" ? "Passengers" : kind === "drivers" ? "Drivers" : "Ride requests"

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">{title}</h1>
        {kind !== "ride-requests" && (
          <div className="flex items-center gap-2 rounded-xl border border-ink-900/10 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-ink-700/40" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone" className="w-56 text-sm outline-none" />
          </div>
        )}
      </div>

      {rows === null ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} found`} />
      ) : (
        <Card className="overflow-x-auto p-0">
          {kind === "passengers" && <PassengerTable rows={rows as PassengerRow[]} />}
          {kind === "drivers" && <DriverTable rows={rows as DriverRow[]} />}
          {kind === "ride-requests" && <RideRequestTable rows={rows as RideRequestRow[]} />}
        </Card>
      )}
    </div>
  )
}

function PassengerTable({ rows }: { rows: PassengerRow[] }) {
  return (
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead>
        <tr className="border-b border-ink-900/[0.06] text-[11px] uppercase tracking-wide text-ink-700/50">
          <th className="px-4 py-2.5 font-semibold">Name</th>
          <th className="px-4 py-2.5 font-semibold">Phone</th>
          <th className="px-4 py-2.5 font-semibold">Rides</th>
          <th className="px-4 py-2.5 font-semibold">Rating</th>
          <th className="px-4 py-2.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="border-b border-ink-900/[0.05] last:border-0">
            <td className="px-4 py-3 font-medium">{p.fullName}</td>
            <td className="px-4 py-3 text-ink-700/70">{p.phone}</td>
            <td className="px-4 py-3">{p.passengerProfile?.completedRides ?? 0}</td>
            <td className="px-4 py-3">{p.passengerProfile?.ratingAvg?.toFixed(2) ?? "—"}</td>
            <td className="px-4 py-3"><Badge tone={statusTone[p.status] ?? "neutral"}>{p.status}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DriverTable({ rows }: { rows: DriverRow[] }) {
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead>
        <tr className="border-b border-ink-900/[0.06] text-[11px] uppercase tracking-wide text-ink-700/50">
          <th className="px-4 py-2.5 font-semibold">Name</th>
          <th className="px-4 py-2.5 font-semibold">City</th>
          <th className="px-4 py-2.5 font-semibold">Rides</th>
          <th className="px-4 py-2.5 font-semibold">Rating</th>
          <th className="px-4 py-2.5 font-semibold">Verification</th>
          <th className="px-4 py-2.5 font-semibold">Availability</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id} className="border-b border-ink-900/[0.05] last:border-0">
            <td className="px-4 py-3 font-medium">{d.fullName}</td>
            <td className="px-4 py-3 text-ink-700/70">{d.driverProfile?.city?.name}</td>
            <td className="px-4 py-3">{d.driverProfile?.completedRides ?? 0}</td>
            <td className="px-4 py-3">{d.driverProfile?.ratingAvg?.toFixed(2) ?? "—"}</td>
            <td className="px-4 py-3"><Badge tone={statusTone[d.driverProfile?.verificationStatus ?? ""] ?? "neutral"}>{d.driverProfile?.verificationStatus}</Badge></td>
            <td className="px-4 py-3"><Badge tone={statusTone[d.driverProfile?.availabilityStatus ?? ""] ?? "neutral"} dot>{d.driverProfile?.availabilityStatus}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RideRequestTable({ rows }: { rows: RideRequestRow[] }) {
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead>
        <tr className="border-b border-ink-900/[0.06] text-[11px] uppercase tracking-wide text-ink-700/50">
          <th className="px-4 py-2.5 font-semibold">Passenger</th>
          <th className="px-4 py-2.5 font-semibold">Pickup</th>
          <th className="px-4 py-2.5 font-semibold">Destination</th>
          <th className="px-4 py-2.5 font-semibold">Mode</th>
          <th className="px-4 py-2.5 font-semibold">Fare</th>
          <th className="px-4 py-2.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-ink-900/[0.05] last:border-0">
            <td className="px-4 py-3 font-medium">{r.passenger.user.fullName}</td>
            <td className="px-4 py-3 text-ink-700/70">{r.pickup.address}</td>
            <td className="px-4 py-3 text-ink-700/70">{r.destination.address}</td>
            <td className="px-4 py-3"><Badge tone={r.bookingMode === "quick_match" ? "brand" : "warning"}>{r.bookingMode === "quick_match" ? "Quick Match" : "Competitive"}</Badge></td>
            <td className="px-4 py-3 font-semibold">Rs {r.proposedFare}</td>
            <td className="px-4 py-3"><Badge tone={statusTone[r.status] ?? "neutral"} dot>{r.status}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
