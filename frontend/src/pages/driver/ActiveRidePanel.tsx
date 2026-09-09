import { useEffect, useState } from "react"
import { MapPin, Navigation, Phone } from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../../components/ui/MapCanvas"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { ridesApi } from "../../api/rides"
import { getSocket } from "../../services/socket"
import { useToast, errorMessage } from "../../shared/Toast"
import type { RideStatus, RideSummary } from "../../types"

const NEXT_ACTION: Partial<Record<RideStatus, { target: RideStatus; label: string }>> = {
  driver_selected: { target: "driver_arriving", label: "I'm on my way" },
  driver_arriving: { target: "driver_arrived", label: "I've arrived" },
  driver_arrived: { target: "ride_started", label: "Start ride" },
  ride_started: { target: "ride_completed", label: "End ride" },
}

export function ActiveRidePanel({ rideId, onCompleted }: { rideId: string; onCompleted: (passengerName: string) => void }) {
  const [ride, setRide] = useState<RideSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const { push } = useToast()

  async function refresh() {
    try {
      const { ride } = await ridesApi.getRide(rideId)
      setRide(ride)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    refresh()
    const socket = getSocket()
    socket?.emit("ride:join", rideId)
    const interval = setInterval(refresh, 4000)
    const onStatus = () => refresh()
    socket?.on("ride.status_changed", onStatus)
    return () => {
      clearInterval(interval)
      socket?.off("ride.status_changed", onStatus)
      socket?.emit("ride:leave", rideId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId])

  async function cancel() {
    if (!confirm("Cancel this ride? This will count against your cancellation rate.")) return
    setBusy(true)
    try {
      await ridesApi.updateStatus(rideId, "cancelled_by_driver", "Driver cancelled")
      push("info", "Ride cancelled.")
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function advance() {
    if (!ride) return
    const action = NEXT_ACTION[ride.status]
    if (!action) return
    setBusy(true)
    try {
      const { ride: updated } = await ridesApi.updateStatus(rideId, action.target)
      setRide(updated)
      if (updated.status === "ride_completed") onCompleted(ride.passenger.user.fullName)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!ride) return <div className="flex flex-1 items-center justify-center text-sm text-ink-700/60">Loading ride…</div>

  const action = NEXT_ACTION[ride.status]

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-4 scrollbar-none">
      <MapCanvas className="h-44 shrink-0">
        <Pin x={30} y={62} variant="pickup" />
        <Pin x={70} y={28} variant="destination" />
        <CarMarker x={48} y={45} rotate={20} />
      </MapCanvas>

      <div className="px-4 pt-4">
        <Badge tone="brand" dot>{ride.status.replace(/_/g, " ")}</Badge>

        <Card className="mt-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">{ride.passenger.user.fullName}</p>
              <p className="text-xs text-ink-700/60">{ride.paymentMethod === "cash" ? "Cash payment" : ride.paymentMethod}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-700/50">Fare</p>
              <p className="font-display text-lg font-extrabold text-rivo-600">Rs {ride.agreedFare}</p>
            </div>
          </div>
          <div className="mt-3 space-y-2 rounded-xl bg-ink-900/[0.03] p-3">
            <div className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rivo-600" />
              <span className="font-medium">{ride.pickup.address}</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">{ride.destination.address}</span>
            </div>
          </div>
          <button
            onClick={() => push("info", "Calling is masked in production — this demo has no live telephony integration.")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900/[0.05] py-2.5 text-sm font-semibold"
          >
            <Phone className="h-4 w-4" /> Call passenger
          </button>
        </Card>

        <div className="mt-4 flex gap-2.5">
          {ride.status !== "ride_started" && (
            <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
          )}
          {action && (
            <Button fullWidth size="lg" icon={<Navigation className="h-4 w-4" />} onClick={advance} disabled={busy}>
              {busy ? "Updating…" : action.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
