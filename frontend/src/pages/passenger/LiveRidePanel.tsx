import { useEffect, useState } from "react"
import { AlertTriangle, MessageCircle, Phone, Share2, Star } from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../../components/ui/MapCanvas"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { ridesApi } from "../../api/rides"
import { safetyApi } from "../../api/safety"
import { getSocket } from "../../services/socket"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { RideStatus, RideSummary } from "../../types"

const STEPS: { status: RideStatus; label: string }[] = [
  { status: "driver_selected", label: "Driver selected" },
  { status: "driver_arriving", label: "On the way" },
  { status: "driver_arrived", label: "Arrived" },
  { status: "ride_started", label: "In progress" },
  { status: "ride_completed", label: "Completed" },
]

export function LiveRidePanel({ rideId, onCompleted }: { rideId: string; onCompleted: () => void }) {
  const [ride, setRide] = useState<RideSummary | null>(null)
  const { push } = useToast()
  const { locale } = useLocale()

  async function refresh() {
    try {
      const { ride } = await ridesApi.getRide(rideId)
      setRide(ride)
      if (ride.status === "ride_completed") onCompleted()
      if (ride.status === "cancelled_by_driver") push("error", "Your driver cancelled the ride.")
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

  async function sos() {
    try {
      const res = await safetyApi.sos({ rideId, lat: ride?.pickup.lat ?? 0, lng: ride?.pickup.lng ?? 0 })
      push("info", res.message)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  async function shareTrip() {
    try {
      const res = await safetyApi.shareTrip(rideId)
      push("success", `Trip link ready: ${res.shareUrl}`)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  if (!ride) {
    return <div className="flex flex-1 items-center justify-center text-sm text-ink-700/60">Loading your ride…</div>
  }

  const activeIndex = STEPS.findIndex((s) => s.status === ride.status)
  const cancelled = ride.status === "cancelled_by_driver" || ride.status === "cancelled_by_passenger"

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-24 scrollbar-none">
      <MapCanvas className="h-48 shrink-0">
        <Pin x={30} y={62} variant="pickup" label={ride.pickup.address} />
        <Pin x={70} y={28} variant="destination" label={ride.destination.address} />
        <CarMarker x={48} y={45} rotate={20} />
      </MapCanvas>

      <div className="px-4 pt-4">
        {cancelled ? (
          <Badge tone="danger" dot>Ride cancelled</Badge>
        ) : (
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.status} className="flex flex-1 items-center gap-1">
                <div className={`h-1.5 flex-1 rounded-full ${i <= activeIndex ? "bg-rivo-600" : "bg-ink-900/10"}`} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-sm font-bold">{cancelled ? ride.status.replace(/_/g, " ") : STEPS[activeIndex]?.label ?? ride.status}</p>

        <Card className="mt-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/[0.06] text-sm font-bold">
              {ride.driver.user.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{ride.driver.user.fullName}</p>
              <div className="flex items-center gap-1 text-xs text-ink-700/60">
                <Star className="h-3 w-3 fill-gold-400 text-gold-400" /> {ride.driver.ratingAvg?.toFixed(2) ?? "5.00"}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-700/50">Fare</p>
              <p className="font-display text-lg font-extrabold text-rivo-600">
                {formatMoney(ride.finalFare ?? ride.agreedFare, ride.driver.city?.currencyCode ?? null, locale)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-xs">
            <span>{ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model}</span>
            <span className="font-mono font-semibold">{ride.vehicle.plateNumber}</span>
          </div>
        </Card>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <button onClick={shareTrip} className="flex flex-col items-center gap-1 rounded-xl bg-white p-3 text-xs font-semibold shadow-rivo-sm">
            <Share2 className="h-4 w-4 text-rivo-600" /> Share
          </button>
          <button
            onClick={() => push("info", "Calling is masked in production — this demo has no live telephony integration.")}
            className="flex flex-col items-center gap-1 rounded-xl bg-white p-3 text-xs font-semibold shadow-rivo-sm"
          >
            <Phone className="h-4 w-4 text-rivo-600" /> Call
          </button>
          <button
            onClick={() => push("info", "Chat is available on the ride detail — this demo shows the entry point only.")}
            className="flex flex-col items-center gap-1 rounded-xl bg-white p-3 text-xs font-semibold shadow-rivo-sm"
          >
            <MessageCircle className="h-4 w-4 text-rivo-600" /> Chat
          </button>
          <button onClick={sos} className="flex flex-col items-center gap-1 rounded-xl bg-danger-500/10 p-3 text-xs font-semibold text-danger-600">
            <AlertTriangle className="h-4 w-4" /> SOS
          </button>
        </div>

        {cancelled && (
          <Button fullWidth className="mt-4" onClick={onCompleted}>
            Back to home
          </Button>
        )}
      </div>
    </div>
  )
}
