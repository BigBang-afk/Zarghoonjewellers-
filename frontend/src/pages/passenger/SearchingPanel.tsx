import { useEffect, useRef, useState } from "react"
import { Loader2, X } from "lucide-react"
import { Button } from "../../components/ui/Button"
import { CancellationReasonSheet } from "../../components/CancellationReasonSheet"
import { ridesApi } from "../../api/rides"
import { getSocket } from "../../services/socket"
import { useToast, errorMessage } from "../../shared/Toast"

/** Quick Match: waiting on a single dispatched driver to accept. */
export function SearchingPanel({
  rideRequestId,
  onMatched,
  onCancelled,
}: {
  rideRequestId: string
  onMatched: (rideId: string) => void
  onCancelled: (reason?: string) => void
}) {
  const { push } = useToast()
  const settled = useRef(false)
  const [showReasons, setShowReasons] = useState(false)

  useEffect(() => {
    settled.current = false

    async function check() {
      if (settled.current) return
      try {
        const { request } = await ridesApi.getRequest(rideRequestId)
        const r = request as { status: string; ride?: { id: string } | null }
        if (r.status === "matched" && r.ride?.id) {
          settled.current = true
          onMatched(r.ride.id)
        } else if (r.status === "expired" || r.status === "cancelled") {
          settled.current = true
          onCancelled(r.status === "expired" ? "No driver accepted in time." : "Request cancelled.")
        }
      } catch (err) {
        push("error", errorMessage(err))
      }
    }

    check()
    const interval = setInterval(check, 3000)
    const socket = getSocket()
    const onNotification = () => check()
    socket?.on("ride.booked", onNotification)
    socket?.on("notification.created", onNotification)

    return () => {
      clearInterval(interval)
      socket?.off("ride.booked", onNotification)
      socket?.off("notification.created", onNotification)
    }
  }, [rideRequestId, onMatched, onCancelled, push])

  async function cancel(reasonCode: string) {
    settled.current = true
    setShowReasons(false)
    try {
      await ridesApi.cancelRequest(rideRequestId, reasonCode)
    } catch {
      // request may have already resolved server-side — proceed to close the panel regardless
    }
    onCancelled()
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute h-16 w-16 animate-ping rounded-full bg-rivo-500/20" />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rivo-600 text-white">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
      <div>
        <p className="font-display text-lg font-bold">Finding your driver…</p>
        <p className="mt-1 text-sm text-ink-700/60">RIVO is contacting the best nearby driver for your trip.</p>
      </div>
      <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setShowReasons(true)}>
        Cancel request
      </Button>
      {showReasons && <CancellationReasonSheet role="passenger" onSelect={cancel} onClose={() => setShowReasons(false)} />}
    </div>
  )
}
