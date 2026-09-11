import { useEffect, useState } from "react"
import { ArrowLeft, MapPin, Star } from "lucide-react"
import { Card } from "./ui/Card"
import { Badge } from "./ui/Badge"
import { LoadingState, EmptyState } from "./ui/States"
import { driverApi } from "../api/driver"
import { passengerApi } from "../api/passenger"
import { useToast, errorMessage } from "../shared/Toast"
import { formatMoney } from "../shared/money"
import { useLocale } from "../i18n"

interface HistoryRide {
  id: string
  status: string
  agreedFare: number
  finalFare: number | null
  createdAt: string
  completedAt: string | null
  cancellationReason: string | null
  pickup: { address: string }
  destination: { address: string }
  vehicle: { make: string; model: string }
  passenger?: { user: { fullName: string } }
  driver?: { user: { fullName: string } }
  payment?: { amount: number; currencyCode: string; commission?: { amount: number } | null } | null
}

const STATUS_TONE: Record<string, "success" | "danger" | "neutral"> = {
  ride_completed: "success",
  cancelled_by_passenger: "danger",
  cancelled_by_driver: "danger",
}

const STATUS_LABEL: Record<string, string> = {
  ride_completed: "Completed",
  cancelled_by_passenger: "Cancelled by passenger",
  cancelled_by_driver: "Cancelled by driver",
}

/** Phase 5 §17 — ride history, shared between passenger and driver (the two API responses differ only in which counterpart's name is included). */
export function RideHistoryPanel({ role, onClose }: { role: "passenger" | "driver"; onClose: () => void }) {
  const { push } = useToast()
  const { locale } = useLocale()
  const [rides, setRides] = useState<HistoryRide[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetcher = role === "passenger" ? passengerApi.rideHistory() : driverApi.rideHistory()
    fetcher
      .then((r) => setRides(r.rides as unknown as HistoryRide[]))
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-4 scrollbar-none">
      <div className="flex items-center gap-3 px-4 pt-4">
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="font-display text-lg font-bold">Ride history</p>
      </div>

      <div className="flex-1 px-4 pt-3">
        {loading ? (
          <LoadingState label="Loading rides…" />
        ) : rides.length === 0 ? (
          <EmptyState icon={MapPin} title="No rides yet" description="Your completed and cancelled rides will show up here." />
        ) : (
          <div className="space-y-2.5">
            {rides.map((r) => {
              const counterpart = role === "passenger" ? r.driver?.user.fullName : r.passenger?.user.fullName
              const fare = r.finalFare ?? r.agreedFare
              return (
                <Card key={r.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{counterpart ?? "—"}</p>
                      <p className="text-[11px] text-ink-700/50">
                        {r.vehicle.make} {r.vehicle.model} · {new Date(r.createdAt).toLocaleDateString(locale)}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                  <div className="mt-2.5 space-y-1.5 rounded-lg bg-ink-900/[0.03] p-2.5 text-xs">
                    <div className="flex items-start gap-1.5">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rivo-600" />
                      <span className="truncate font-medium">{r.pickup.address}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger-500" />
                      <span className="truncate font-medium">{r.destination.address}</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <p className="font-display text-base font-extrabold">{formatMoney(fare, r.payment?.currencyCode ?? null, locale)}</p>
                    {role === "driver" && r.payment?.commission && (
                      <p className="text-[11px] text-ink-700/50">Net: {formatMoney(fare - r.payment.commission.amount, r.payment.currencyCode, locale)}</p>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
