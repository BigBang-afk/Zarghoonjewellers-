import { useEffect, useState } from "react"
import { PackageSearch } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { LostItemReport, LostItemStatus } from "../../types"

const STATUS_LABEL: Record<LostItemStatus, string> = {
  reported: "Reported",
  driver_confirmed_found: "Driver found it",
  driver_confirmed_not_found: "Driver: not found",
  return_arranged: "Return arranged",
  returned: "Returned",
  closed: "Closed",
}

const STATUS_TONE: Record<LostItemStatus, "brand" | "success" | "danger" | "neutral"> = {
  reported: "brand",
  driver_confirmed_found: "success",
  driver_confirmed_not_found: "danger",
  return_arranged: "brand",
  returned: "success",
  closed: "neutral",
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "reported", label: "Reported" },
  { key: "driver_confirmed_found", label: "Found" },
  { key: "driver_confirmed_not_found", label: "Not found" },
  { key: "returned", label: "Returned" },
  { key: "closed", label: "Closed" },
]

export function LostFoundPanel() {
  const { push } = useToast()
  const [statusFilter, setStatusFilter] = useState("")
  const [reports, setReports] = useState<LostItemReport[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    adminApi
      .lostItemReports(statusFilter ? { status: statusFilter } : undefined)
      .then((r) => { setReports(r.reports); setTotal(r.total) })
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [statusFilter])

  async function markResolved(id: string, status: "returned" | "closed") {
    setBusyId(id)
    try {
      await adminApi.updateLostItemReport(id, status)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Lost & found</h1>
          <p className="text-sm text-ink-700/60">{total} report{total === 1 ? "" : "s"} — the message thread on each is its underlying support ticket</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-ink-900/[0.04] p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${statusFilter === f.key ? "bg-white shadow-rivo-sm" : "text-ink-700/60"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading reports…" />
      ) : reports.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No reports" description="No lost-item reports match this filter." />
      ) : (
        <div className="space-y-2.5">
          {reports.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{r.itemDescription}</p>
                  <p className="text-xs text-ink-700/50">
                    {r.itemCategory.replace(/_/g, " ")} · {r.reporter?.fullName ?? "Passenger"} → {r.driver?.fullName ?? "Driver"}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.status !== "returned" && r.status !== "closed" && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => markResolved(r.id, "returned")}
                    disabled={busyId === r.id}
                    className="rounded-lg bg-success-500/10 px-3 py-1.5 text-xs font-bold text-success-600 disabled:opacity-40"
                  >
                    Mark returned
                  </button>
                  <button
                    onClick={() => markResolved(r.id, "closed")}
                    disabled={busyId === r.id}
                    className="rounded-lg bg-ink-900/[0.06] px-3 py-1.5 text-xs font-bold text-ink-700 disabled:opacity-40"
                  >
                    Close
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
