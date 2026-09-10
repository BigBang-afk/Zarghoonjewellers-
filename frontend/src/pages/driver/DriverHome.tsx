import { useEffect, useRef, useState } from "react"
import { Banknote, Bell, Clock, Navigation, Power, Route, Star, TrendingUp, User, Wallet, X } from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../../components/ui/MapCanvas"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Badge } from "../../components/ui/Badge"
import { LoadingState } from "../../components/ui/States"
import { driverApi } from "../../api/driver"
import { ridesApi } from "../../api/rides"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"
import { getSocket } from "../../services/socket"
import { ISLAMABAD_CURRENT_LOCATION_FALLBACK } from "../../shared/islamabadPlaces"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { DriverEarningsSummary, IncomingRequestSummary } from "../../types"
import { ActiveRidePanel } from "./ActiveRidePanel"
import { DriverRatingPanel } from "./DriverRatingPanel"
import { EarningsPanel } from "./EarningsPanel"

export function DriverHome() {
  const { user } = useAuth()
  const { push } = useToast()
  const { locale } = useLocale()

  const [loading, setLoading] = useState(true)
  const [verificationStatus, setVerificationStatus] = useState<string>("pending")
  const [online, setOnline] = useState(false)
  const [rating, setRating] = useState(5)
  const [todayRs, setTodayRs] = useState(0)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [tab, setTab] = useState<"home" | "earnings">("home")

  const [incoming, setIncoming] = useState<IncomingRequestSummary[]>([])
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [counterMode, setCounterMode] = useState(false)
  const [counterFare, setCounterFare] = useState(0)
  const [busy, setBusy] = useState(false)

  const [activeRideId, setActiveRideId] = useState<string | null>(null)
  const [justCompleted, setJustCompleted] = useState<{ rideId: string; passengerName: string } | null>(null)

  const locationTimer = useRef<number | null>(null)

  async function loadProfile() {
    try {
      const { driverProfile } = await driverApi.me()
      setVerificationStatus(driverProfile.verificationStatus as string)
      setOnline(driverProfile.availabilityStatus === "online")
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadEarningsSnapshot() {
    try {
      const data: DriverEarningsSummary = await driverApi.earnings()
      setTodayRs(data.today.totalRs)
      setCurrencyCode(data.currencyCode)
      setRating(data.rating)
    } catch {
      // non-critical for the home screen
    }
  }

  async function checkActiveRide() {
    try {
      const { ride } = await driverApi.activeRide()
      setActiveRideId(ride?.id ?? null)
    } catch {
      // ignore transient errors — next poll will retry
    }
  }

  async function refreshIncoming() {
    if (activeRideId) return
    try {
      const { offers } = await driverApi.incomingRequests()
      setIncoming(offers.filter((o) => !dismissedIds.includes(o.id)))
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    loadProfile()
    loadEarningsSnapshot()
    checkActiveRide()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      checkActiveRide()
      if (online) refreshIncoming()
    }, 3000)
    const socket = getSocket()
    const onIncoming = () => refreshIncoming()
    socket?.on("ride_request.created", onIncoming)
    socket?.on("ride.booked", () => checkActiveRide())
    return () => {
      clearInterval(interval)
      socket?.off("ride_request.created", onIncoming)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, activeRideId, dismissedIds])

  // Broadcast a location fix while online — real geolocation if granted,
  // otherwise a fixed Islamabad demo point (never silently "fake" a
  // moving position). Each distinct failure mode is surfaced once so the
  // driver understands why their pin might be stuck (Phase 4 §6).
  useEffect(() => {
    let warnedPermission = false
    let warnedUnavailable = false
    let consecutiveNetworkFailures = 0

    function handleGeolocationError(err: GeolocationPositionError) {
      const fallback = ISLAMABAD_CURRENT_LOCATION_FALLBACK
      if (err.code === err.PERMISSION_DENIED) {
        if (!warnedPermission) {
          push("info", "Location permission denied — using an approximate position until you enable it.")
          warnedPermission = true
        }
      } else if (!warnedUnavailable) {
        push("info", "Couldn't get a GPS fix — using an approximate position for now.")
        warnedUnavailable = true
      }
      driverApi.updateLocation(fallback.lat, fallback.lng).catch(() => {})
    }

    async function sendLocation() {
      const fallback = ISLAMABAD_CURRENT_LOCATION_FALLBACK
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            consecutiveNetworkFailures = 0
            driverApi.updateLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy).catch(() => {
              consecutiveNetworkFailures++
              if (consecutiveNetworkFailures === 3) push("error", "Your location updates aren't reaching RIVO — check your connection.")
            })
          },
          handleGeolocationError,
          { timeout: 4000 },
        )
      } else {
        await driverApi.updateLocation(fallback.lat, fallback.lng).catch(() => {})
      }
    }
    if (online) {
      sendLocation()
      locationTimer.current = window.setInterval(sendLocation, 15000)
    }
    return () => {
      if (locationTimer.current) window.clearInterval(locationTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  async function toggleOnline() {
    const next = !online
    setBusy(true)
    try {
      await driverApi.setAvailability(next ? "online" : "offline")
      setOnline(next)
      if (next) refreshIncoming()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const current = incoming[0]

  async function accept(offerId: string) {
    setBusy(true)
    try {
      const result = await ridesApi.acceptOffer(offerId)
      if (result.kind === "booked" && result.ride) {
        setActiveRideId(result.ride.id)
      } else {
        push("success", "Offer sent — waiting for the passenger to choose.")
      }
      setIncoming((list) => list.filter((o) => o.id !== offerId))
    } catch (err) {
      push("error", errorMessage(err))
      refreshIncoming()
    } finally {
      setBusy(false)
      setCounterMode(false)
    }
  }

  async function decline(offerId: string) {
    setBusy(true)
    try {
      await ridesApi.declineOffer(offerId)
      setIncoming((list) => list.filter((o) => o.id !== offerId))
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendCounter(offerId: string) {
    setBusy(true)
    try {
      await ridesApi.counterOffer(offerId, counterFare)
      push("success", "Counter-offer sent to the passenger.")
      setIncoming((list) => list.filter((o) => o.id !== offerId))
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
      setCounterMode(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center bg-[#EDEBFB] py-0 sm:py-6">
        <div className="flex h-[calc(100vh-41px)] w-full max-w-md items-center justify-center bg-[#F6F5FB] sm:h-[840px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink-900">
          <LoadingState label="Loading your driver account…" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-center bg-[#EDEBFB] py-0 sm:py-6">
      <div className="relative flex h-[calc(100vh-41px)] w-full max-w-md flex-col overflow-hidden bg-[#F6F5FB] sm:h-[840px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink-900 sm:shadow-rivo-lg">
        {activeRideId ? (
          <ActiveRidePanel rideId={activeRideId} onCompleted={(passengerName) => { setJustCompleted({ rideId: activeRideId, passengerName }); setActiveRideId(null) }} />
        ) : justCompleted ? (
          <DriverRatingPanel
            rideId={justCompleted.rideId}
            passengerName={justCompleted.passengerName}
            onDone={() => { setJustCompleted(null); loadEarningsSnapshot() }}
          />
        ) : tab === "earnings" ? (
          <EarningsPanel />
        ) : (
          <>
            <MapCanvas className="relative flex-1">
              <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
                <div className="flex items-center gap-2.5 rounded-full bg-white/95 py-1.5 pl-1.5 pr-3 shadow-rivo-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rivo-600 text-xs font-bold text-white">
                    {user?.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </div>
                  <div className="leading-tight">
                    <p className="text-xs font-bold">{user?.fullName}</p>
                    <div className="flex items-center gap-1 text-[10px] text-ink-700/60">
                      <Star className="h-2.5 w-2.5 fill-gold-400 text-gold-400" /> {rating.toFixed(2)}
                    </div>
                  </div>
                </div>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-rivo-sm">
                  <Bell className="h-4 w-4" />
                </button>
              </div>

              {verificationStatus !== "approved" ? (
                <div className="absolute inset-x-4 top-20 rounded-2xl bg-white/95 p-4 text-center shadow-rivo-md">
                  <Badge tone="warning">Verification pending</Badge>
                  <p className="mt-2 text-sm text-ink-700">Your documents are under review. You'll be able to go online once an admin approves them.</p>
                </div>
              ) : (
                <>
                  <Pin x={50} y={55} variant="you" />
                  <CarMarker x={30} y={30} rotate={10} />
                  <CarMarker x={72} y={38} rotate={-20} />
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                    <button
                      onClick={toggleOnline}
                      disabled={busy}
                      className={`flex items-center gap-2.5 rounded-full px-5 py-3 shadow-rivo-lg transition-colors ${online ? "bg-success-500 text-white" : "bg-ink-900 text-white"}`}
                    >
                      <Power className="h-4 w-4" />
                      <span className="text-sm font-bold">{online ? "You're online" : "You're offline"}</span>
                      <span className={`ml-1 h-2 w-2 rounded-full ${online ? "bg-white animate-pulse" : "bg-white/40"}`} />
                    </button>
                  </div>
                </>
              )}
            </MapCanvas>

            <div className="grid grid-cols-4 gap-2 border-t border-ink-900/[0.06] bg-white px-4 py-3">
              {[
                { label: "Today", value: formatMoney(todayRs, currencyCode, locale), icon: Wallet },
                { label: "Status", value: online ? "Online" : "Offline", icon: Route },
                { label: "Verified", value: verificationStatus === "approved" ? "Yes" : "Pending", icon: Clock },
                { label: "Rating", value: rating.toFixed(2), icon: Star },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-0.5">
                  <s.icon className="h-3.5 w-3.5 text-rivo-600" />
                  <span className="text-xs font-extrabold">{s.value}</span>
                  <span className="text-[9px] text-ink-700/50">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-around border-t border-ink-900/[0.06] bg-white py-3">
              {[
                { icon: Navigation, label: "Home", key: "home" as const },
                { icon: TrendingUp, label: "Earnings", key: "earnings" as const },
                { icon: Banknote, label: "Wallet", key: "home" as const },
                { icon: User, label: "Profile", key: "home" as const },
              ].map((t, i) => (
                <button key={i} onClick={() => setTab(t.key)} className={`flex flex-col items-center gap-0.5 ${tab === t.key && t.label !== "Wallet" && t.label !== "Profile" ? "text-rivo-600" : "text-ink-700/50"}`}>
                  <t.icon className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>

            {online && current && (
              <div className="absolute inset-x-0 bottom-0 top-0 flex items-end bg-ink-900/40 p-3">
                <Card className="w-full p-4">
                  <div className="flex items-center justify-between">
                    <Badge tone="brand" dot>{current.bookingMode === "quick_match" ? "Quick Match request" : "New ride request"}</Badge>
                    <button onClick={() => setDismissedIds((d) => [...d, current.id])} className="text-ink-700/50"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/[0.06] text-sm font-bold">
                      {current.passenger.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{current.passenger.name}</p>
                      <div className="flex items-center gap-1 text-xs text-ink-700/60">
                        <Star className="h-3 w-3 fill-gold-400 text-gold-400" /> {current.passenger.rating.toFixed(2)}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-[10px] text-ink-700/50">{current.bookingMode === "quick_match" ? "Fare" : "Proposed fare"}</p>
                      <p className="font-display text-xl font-extrabold text-rivo-600">{formatMoney(current.offerPrice, currencyCode, locale)}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 rounded-xl bg-ink-900/[0.03] p-3">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rivo-600" />
                      <span className="font-medium">{current.pickup}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <Navigation className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium">{current.destination}</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="font-bold">{current.distanceKm.toFixed(1)} km</p><p className="text-[10px] text-ink-700/50">Distance</p></div>
                    <div><p className="font-bold">{current.etaMin} min</p><p className="text-[10px] text-ink-700/50">ETA</p></div>
                    <div><p className="font-bold capitalize">{current.paymentMethod}</p><p className="text-[10px] text-ink-700/50">Payment</p></div>
                  </div>

                  {!counterMode ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Button variant="danger" onClick={() => decline(current.id)} disabled={busy}>Decline</Button>
                      <Button
                        variant="secondary"
                        onClick={() => { setCounterFare(Math.round(current.offerPrice * 1.1)); setCounterMode(true) }}
                        disabled={busy || current.bookingMode === "quick_match"}
                      >
                        Counter
                      </Button>
                      <Button variant="primary" onClick={() => accept(current.id)} disabled={busy}>
                        Accept {formatMoney(current.offerPrice, currencyCode, locale)}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-ink-900/10 p-3">
                      <p className="text-xs font-semibold text-ink-700/70">Your counter-offer</p>
                      <div className="mt-2 flex items-center justify-between">
                        <button onClick={() => setCounterFare((f) => Math.max(50, f - 20))} className="h-9 w-9 rounded-full bg-ink-900/[0.06] font-bold">–</button>
                        <span className="font-display text-2xl font-extrabold">{formatMoney(counterFare, currencyCode, locale)}</span>
                        <button onClick={() => setCounterFare((f) => f + 20)} className="h-9 w-9 rounded-full bg-ink-900/[0.06] font-bold">+</button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setCounterMode(false)}>Back</Button>
                        <Button variant="gold" onClick={() => sendCounter(current.id)} disabled={busy}>Send counter</Button>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
