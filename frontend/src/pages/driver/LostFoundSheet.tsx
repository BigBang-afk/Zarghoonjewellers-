import { useEffect, useState } from "react"
import { X, PackageSearch, Check, XCircle } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { driverApi } from "../../api/driver"
import { useToast, errorMessage } from "../../shared/Toast"
import type { LostItemReport, LostItemStatus } from "../../types"

const STATUS_LABEL: Record<LostItemStatus, string> = {
  reported: "Awaiting your response",
  driver_confirmed_found: "You confirmed found",
  driver_confirmed_not_found: "You said not found",
  return_arranged: "Return arranged",
  returned: "Returned to passenger",
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

/** Phase 5 §15 — driver's incoming lost-item reports, reached from the Bell icon on DriverHome. */
export function LostFoundSheet({ onClose }: { onClose: () => void }) {
  const { push } = useToast()
  const [reports, setReports] = useState<LostItemReport[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    driverApi
      .lostItemReports()
      .then((r) => setReports(r.reports))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function respond(id: string, found: boolean) {
    setBusyId(id)
    try {
      await driverApi.respondToLostItem(id, found)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl bg-white p-5 shadow-rivo-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-lg font-bold">Lost & found</p>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-900/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState label="Loading reports…" />
          ) : reports.length === 0 ? (
            <EmptyState icon={PackageSearch} title="Nothing reported" description="No passengers have reported a lost item from your rides." />
          ) : (
            <div className="space-y-2.5">
              {reports.map((r) => (
                <Card key={r.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{r.itemDescription}</p>
                      <p className="text-xs text-ink-700/50">{r.reporter?.fullName ?? "Passenger"} · {r.itemCategory.replace(/_/g, " ")}</p>
                    </div>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  {r.status === "reported" && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() => respond(r.id, true)}
                        disabled={busyId === r.id}
                      >
                        Found it
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<XCircle className="h-3.5 w-3.5" />}
                        onClick={() => respond(r.id, false)}
                        disabled={busyId === r.id}
                      >
                        Not found
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
