import { useEffect, useState } from "react"
import { Star, X, ArrowDownUp, ShieldCheck } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Badge } from "../../components/ui/Badge"
import { EmptyState } from "../../components/ui/States"
import { ridesApi } from "../../api/rides"
import { getSocket } from "../../services/socket"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { DriverOfferSummary } from "../../types"

type SortKey = "price" | "eta" | "rating" | "distance"

export function OffersPanel({
  rideRequestId,
  currencyCode,
  onBooked,
  onCancelled,
}: {
  rideRequestId: string
  currencyCode: string | null
  onBooked: (rideId: string) => void
  onCancelled: () => void
}) {
  const { locale } = useLocale()
  const [offers, setOffers] = useState<DriverOfferSummary[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("price")
  const [busyId, setBusyId] = useState<string | null>(null)
  const { push } = useToast()

  async function refresh() {
    try {
      const { offers, statusMessage } = await ridesApi.getOffers(rideRequestId)
      setOffers(offers)
      setStatusMessage(statusMessage)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 3000)
    const socket = getSocket()
    const onEvent = () => refresh()
    socket?.on("ride_offer.accepted", onEvent)
    socket?.on("counter_offer.created", onEvent)
    socket?.on("ride_offer.expired", onEvent)
    return () => {
      clearInterval(interval)
      socket?.off("ride_offer.accepted", onEvent)
      socket?.off("counter_offer.created", onEvent)
      socket?.off("ride_offer.expired", onEvent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideRequestId])

  const sorted = [...offers].sort((a, b) => {
    const priceA = a.counterOffer?.counterPrice ?? a.offerPrice
    const priceB = b.counterOffer?.counterPrice ?? b.offerPrice
    if (sortKey === "price") return priceA - priceB
    if (sortKey === "eta") return a.etaMin - b.etaMin
    if (sortKey === "rating") return b.driver.rating - a.driver.rating
    return a.distanceKm - b.distanceKm
  })

  async function selectOffer(offer: DriverOfferSummary) {
    setBusyId(offer.id)
    try {
      let ride
      if (offer.counterOffer) {
        const res = await ridesApi.acceptCounterOffer(offer.counterOffer.id)
        ride = res.ride
      } else {
        const res = await ridesApi.selectOffer(rideRequestId, offer.id)
        ride = res.ride
      }
      onBooked(ride.id)
    } catch (err) {
      push("error", errorMessage(err))
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function cancel() {
    try {
      await ridesApi.cancelRequest(rideRequestId)
    } catch {
      // ignore — proceed to close regardless
    }
    onCancelled()
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-bold">Available drivers</p>
          <p className="text-xs text-ink-700/60">{statusMessage ?? `${offers.length} ${offers.length === 1 ? "offer" : "offers"} so far`}</p>
        </div>
        <button onClick={cancel} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 overflow-x-auto scrollbar-none">
        <ArrowDownUp className="h-3.5 w-3.5 shrink-0 text-ink-700/40" />
        {(["price", "eta", "rating", "distance"] as SortKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSortKey(k)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              sortKey === k ? "bg-rivo-600 text-white" : "bg-white text-ink-700 border border-ink-900/10"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Waiting for drivers…" description="Nearby drivers are reviewing your request. Offers will appear here as they come in." />
      ) : (
        <div className="space-y-3">
          {sorted.map((o) => {
            const price = o.counterOffer?.counterPrice ?? o.offerPrice
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/[0.06] text-sm font-bold">
                      {o.driver.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-bold">{o.driver.name}</p>
                        {o.driver.verified && <ShieldCheck className="h-3.5 w-3.5 text-success-500" />}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-ink-700/60">
                        <Star className="h-3 w-3 fill-gold-400 text-gold-400" /> {o.driver.rating.toFixed(2)}
                        <span className="mx-1">·</span> {o.driver.completedRides} rides
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-extrabold text-rivo-600">{formatMoney(price, currencyCode, locale)}</p>
                    {o.counterOffer ? <Badge tone="warning">Counter</Badge> : o.status === "pending" ? <Badge tone="neutral">Awaiting response</Badge> : null}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-ink-700/60">
                  <span>{o.vehicle.model} · {o.vehicle.color}</span>
                  <span>{o.etaMin} min · {o.distanceKm.toFixed(1)} km away</span>
                </div>
                {(() => {
                  const canSelect = o.status === "accepted" || Boolean(o.counterOffer)
                  return (
                    <Button
                      fullWidth
                      variant={canSelect ? "primary" : "secondary"}
                      className="mt-3"
                      onClick={() => canSelect && selectOffer(o)}
                      disabled={busyId === o.id || !canSelect}
                    >
                      {busyId === o.id ? "Booking…" : canSelect ? "Select this driver" : "Waiting for driver to respond…"}
                    </Button>
                  )
                })()}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
