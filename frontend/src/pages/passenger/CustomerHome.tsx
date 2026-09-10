import { useEffect, useState } from "react"
import {
  Bell,
  Briefcase,
  Clock,
  Home as HomeIcon,
  MapPin,
  Minus,
  Navigation,
  Plus,
  Search,
  User,
  Wallet,
  Zap,
} from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../../components/ui/MapCanvas"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { VehicleIcon } from "../../components/VehicleIcon"
import { LoadingState } from "../../components/ui/States"
import { publicApi } from "../../api/public"
import { passengerApi, type RecentPlace, type SavedPlace } from "../../api/passenger"
import { ridesApi, type Place } from "../../api/rides"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"
import { useLocale } from "../../i18n"
import { formatMoney, getCurrencyMeta } from "../../shared/money"
import { ISLAMABAD_CURRENT_LOCATION_FALLBACK, POPULAR_ISLAMABAD_PLACES } from "../../shared/islamabadPlaces"
import type { City, FareEstimate, VehicleType } from "../../types"
import { SearchingPanel } from "./SearchingPanel"
import { OffersPanel } from "./OffersPanel"
import { LiveRidePanel } from "./LiveRidePanel"
import { RatingPanel } from "./RatingPanel"
import { WalletPanel } from "./WalletPanel"
import { ReferralPanel } from "../../components/ReferralPanel"

type View = "home" | "searching" | "offers" | "live" | "rating" | "wallet" | "referral"

export function CustomerHome() {
  const { user } = useAuth()
  const { push } = useToast()
  const { t, locale } = useLocale()

  const [loadingRefData, setLoadingRefData] = useState(true)
  const [city, setCity] = useState<City | null>(null)
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])
  const [pickup] = useState<Place>(ISLAMABAD_CURRENT_LOCATION_FALLBACK)
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  const [recentPlaces, setRecentPlaces] = useState<RecentPlace[]>([])

  const [destination, setDestination] = useState<Place | null>(null)
  const [vehicleTypeId, setVehicleTypeId] = useState<string>("")
  const [fareByVehicle, setFareByVehicle] = useState<Record<string, FareEstimate["fare"]>>({})
  const [loadingFares, setLoadingFares] = useState(false)
  const [mode, setMode] = useState<"quick" | "custom" | null>(null)
  const [customFare, setCustomFare] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [promoCode, setPromoCode] = useState("")
  const [promoStatus, setPromoStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [checkingPromo, setCheckingPromo] = useState(false)

  const [view, setView] = useState<View>("home")
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeRideId, setActiveRideId] = useState<string | null>(null)
  const [lastDriverName, setLastDriverName] = useState("your driver")
  const [lastDriverId, setLastDriverId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const { cities } = await publicApi.cities()
        const liveCity = cities.find((c) => c.status === "live") ?? cities[0] ?? null
        setCity(liveCity)
        if (liveCity) {
          const { vehicleTypes } = await publicApi.vehicleTypes(liveCity.id)
          setVehicleTypes(vehicleTypes)
          if (vehicleTypes[0]) setVehicleTypeId(vehicleTypes[0].id)
        }
        const [saved, recent] = await Promise.all([passengerApi.savedPlaces(), passengerApi.recentPlaces()])
        setSavedPlaces(saved.locations)
        setRecentPlaces(recent.locations)
      } catch (err) {
        push("error", errorMessage(err))
      } finally {
        setLoadingRefData(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function chooseDestination(place: Place) {
    setDestination(place)
    setMode(null)
    setPromoCode("")
    setPromoStatus(null)
    if (!city) return
    setLoadingFares(true)
    try {
      const results = await Promise.all(
        vehicleTypes.map((vt) => ridesApi.fareEstimate({ cityId: city.id, vehicleTypeId: vt.id, pickup, destination: place })),
      )
      const map: Record<string, FareEstimate["fare"]> = {}
      results.forEach((r, i) => (map[vehicleTypes[i].id] = r.fare))
      setFareByVehicle(map)
      if (vehicleTypeId && map[vehicleTypeId]) setCustomFare(map[vehicleTypeId].suggestedFare)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setLoadingFares(false)
    }
  }

  function chooseVehicle(id: string) {
    setVehicleTypeId(id)
    const fare = fareByVehicle[id]
    if (fare) setCustomFare(fare.suggestedFare)
  }

  const selectedFare = fareByVehicle[vehicleTypeId]

  async function checkPromo() {
    if (!city || !promoCode.trim() || !selectedFare) return
    setCheckingPromo(true)
    setPromoStatus(null)
    try {
      const result = await passengerApi.validatePromo({
        code: promoCode.trim(),
        cityId: city.id,
        vehicleTypeId,
        fareAmount: mode === "custom" ? customFare : selectedFare.suggestedFare,
      })
      setPromoStatus({ ok: true, message: `${formatMoney(result.discountAmount, city.currencyCode, locale)} off applied` })
    } catch (err) {
      setPromoStatus({ ok: false, message: errorMessage(err) })
    } finally {
      setCheckingPromo(false)
    }
  }

  async function confirmBooking() {
    if (!city || !destination || !mode) return
    setSubmitting(true)
    try {
      const result = await ridesApi.createRequest({
        cityId: city.id,
        vehicleTypeId,
        pickup,
        destination,
        bookingMode: mode === "quick" ? "quick_match" : "competitive_offer",
        proposedFare: mode === "custom" ? customFare : undefined,
        paymentMethod: "cash",
        promoCode: promoStatus?.ok ? promoCode.trim() : undefined,
      })
      setActiveRequestId(result.request.id)
      if (result.dispatch.status === "no_drivers") {
        push("error", "No drivers were available near your pickup. Try again shortly.")
        return
      }
      setView(mode === "quick" ? "searching" : "offers")
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function resetToHome() {
    setView("home")
    setDestination(null)
    setMode(null)
    setActiveRequestId(null)
    setActiveRideId(null)
    passengerApi.recentPlaces().then((r) => setRecentPlaces(r.locations))
  }

  function onRideBooked(rideId: string) {
    setActiveRideId(rideId)
    ridesApi.getRide(rideId).then(({ ride }) => {
      setLastDriverName(ride.driver.user.fullName)
      setLastDriverId(ride.driver.id)
    }).catch(() => {})
    setView("live")
  }

  return (
    <div className="flex justify-center bg-[#EDEBFB] py-0 sm:py-6">
      <div className="relative flex h-[calc(100vh-41px)] w-full max-w-md flex-col overflow-hidden bg-[#F6F5FB] sm:h-[840px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink-900 sm:shadow-rivo-lg">
        {view === "searching" && activeRequestId && (
          <SearchingPanel rideRequestId={activeRequestId} onMatched={onRideBooked} onCancelled={(reason) => { if (reason) push("info", reason); resetToHome() }} />
        )}
        {view === "offers" && activeRequestId && (
          <OffersPanel rideRequestId={activeRequestId} currencyCode={city?.currencyCode ?? null} onBooked={onRideBooked} onCancelled={resetToHome} />
        )}
        {view === "live" && activeRideId && <LiveRidePanel rideId={activeRideId} onCompleted={() => setView("rating")} />}
        {view === "rating" && activeRideId && (
          <RatingPanel rideId={activeRideId} driverName={lastDriverName} driverId={lastDriverId} onDone={resetToHome} />
        )}
        {view === "wallet" && <WalletPanel onClose={() => setView("home")} onOpenReferral={() => setView("referral")} />}
        {view === "referral" && <ReferralPanel onClose={() => setView("home")} />}

        {view === "home" &&
          (loadingRefData ? (
            <LoadingState label="Loading RIVO…" />
          ) : (
            <>
              <MapCanvas className="relative h-[42%] shrink-0">
                <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-rivo-sm">
                    <span className="h-2 w-2 rounded-full bg-success-500" />
                    <span className="text-xs font-semibold">{city?.name ?? "RIVO"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-rivo-sm">
                      <Bell className="h-4 w-4" />
                    </button>
                    <div className="flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 shadow-rivo-sm">
                      <Wallet className="h-3.5 w-3.5 text-rivo-600" />
                      <span className="text-xs font-bold">{user?.fullName.split(" ")[0]}</span>
                    </div>
                  </div>
                </div>
                <Pin x={48} y={58} variant="you" />
                <CarMarker x={30} y={35} rotate={-15} />
                <CarMarker x={68} y={70} rotate={30} />
                <div className="absolute bottom-3 right-3 flex flex-col gap-2">
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Plus className="h-4 w-4" /></button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Minus className="h-4 w-4" /></button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Navigation className="h-4 w-4 text-rivo-600" /></button>
                </div>
              </MapCanvas>

              <div className="-mt-5 flex flex-1 flex-col overflow-y-auto rounded-t-[1.75rem] bg-[#F6F5FB] px-4 pb-24 pt-4 scrollbar-none">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-900/10" />

                <div className="flex items-center gap-3 rounded-2xl border border-ink-900/10 bg-white px-4 py-3.5 shadow-rivo-sm">
                  <Search className="h-4 w-4 text-ink-700/50" />
                  <span className={destination ? "font-semibold text-ink-900" : "text-ink-700/50"}>
                    {destination ? destination.address : "Where to?"}
                  </span>
                </div>

                {savedPlaces.length > 0 && (
                  <div className="mt-4 flex gap-3">
                    {savedPlaces.map((p) => (
                      <button key={p.id} onClick={() => chooseDestination(p)} className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 text-left shadow-rivo-sm">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rivo-600/10 text-rivo-600">
                          {p.label.toLowerCase() === "home" ? <HomeIcon className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold">{p.label}</p>
                          <p className="truncate text-[10px] text-ink-700/60">{p.address}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-700/50">
                    {recentPlaces.length > 0 ? "Recent" : "Popular in Islamabad"}
                  </p>
                  <div className="space-y-1">
                    {(recentPlaces.length > 0 ? recentPlaces : POPULAR_ISLAMABAD_PLACES).slice(0, 6).map((r, i) => (
                      <button
                        key={`${r.address}-${i}`}
                        onClick={() => chooseDestination(r)}
                        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${destination?.address === r.address ? "bg-rivo-600/10" : "hover:bg-white"}`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900/[0.05]">
                          {recentPlaces.length > 0 ? <Clock className="h-4 w-4 text-ink-700/60" /> : <MapPin className="h-4 w-4 text-ink-700/60" />}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{r.address}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {destination && (
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-700/50">Choose a ride</p>
                    {loadingFares ? (
                      <LoadingState label="Getting fares…" />
                    ) : (
                      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
                        {vehicleTypes.map((v) => (
                          <button
                            key={v.id}
                            onClick={() => chooseVehicle(v.id)}
                            className={`flex w-[104px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 transition-colors ${
                              vehicleTypeId === v.id ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10 bg-white"
                            }`}
                          >
                            <VehicleIcon type={v.code} className="h-6 w-6 text-ink-900" />
                            <span className="text-xs font-bold">{v.name}</span>
                            <span className="text-xs font-extrabold text-rivo-600">
                              {fareByVehicle[v.id] ? formatMoney(fareByVehicle[v.id].suggestedFare, fareByVehicle[v.id].currencyCode, locale) : "…"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedFare && !loadingFares && (
                      <>
                        <div className="mt-4 grid grid-cols-2 gap-2.5">
                          <button
                            onClick={() => setMode("quick")}
                            className={`rounded-2xl border p-3.5 text-left transition-colors ${mode === "quick" ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10 bg-white"}`}
                          >
                            <Zap className="h-4 w-4 text-rivo-600" />
                            <p className="mt-2 text-sm font-bold">Quick Match</p>
                            <p className="text-[11px] text-ink-700/60">Best driver, auto-matched</p>
                          </button>
                          <button
                            onClick={() => { setMode("custom"); setCustomFare(selectedFare.suggestedFare) }}
                            className={`rounded-2xl border p-3.5 text-left transition-colors ${mode === "custom" ? "border-gold-500 bg-gold-400/10" : "border-ink-900/10 bg-white"}`}
                          >
                            <span className="font-display text-sm font-extrabold text-gold-600">
                              {getCurrencyMeta(selectedFare?.currencyCode ?? city?.currencyCode ?? "PKR").symbol}
                            </span>
                            <p className="mt-2 text-sm font-bold">Set Your Price</p>
                            <p className="text-[11px] text-ink-700/60">Drivers bid on your fare</p>
                          </button>
                        </div>

                        <p className="mt-2 text-[11px] text-ink-700/50">
                          Estimate only · typically {formatMoney(selectedFare.typicalRangeLow, selectedFare.currencyCode, locale)}–{formatMoney(selectedFare.typicalRangeHigh, selectedFare.currencyCode, locale)}
                        </p>

                        {mode === "custom" && (
                          <Card className="mt-3 flex items-center justify-between p-4">
                            <div>
                              <p className="text-xs text-ink-700/60">Your offer</p>
                              <p className="font-display text-2xl font-extrabold">{formatMoney(customFare, selectedFare.currencyCode, locale)}</p>
                              <p className="text-[11px] text-ink-700/50">
                                Min {formatMoney(selectedFare.minimumFare, selectedFare.currencyCode, locale)} · Suggested {formatMoney(selectedFare.suggestedFare, selectedFare.currencyCode, locale)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setCustomFare((f) => Math.max(selectedFare.minimumFare, f - 20))} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.06]">
                                <Minus className="h-4 w-4" />
                              </button>
                              <button onClick={() => setCustomFare((f) => f + 20)} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.06]">
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </Card>
                        )}

                        {mode && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <input
                                value={promoCode}
                                onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoStatus(null) }}
                                placeholder="Promo code"
                                className="h-10 flex-1 rounded-xl border border-ink-900/10 bg-white px-3 text-sm font-semibold uppercase outline-none focus:border-rivo-600"
                              />
                              <Button size="sm" variant="secondary" onClick={checkPromo} disabled={!promoCode.trim() || checkingPromo}>
                                {checkingPromo ? "…" : "Apply"}
                              </Button>
                            </div>
                            {promoStatus && (
                              <p className={`mt-1.5 text-xs font-semibold ${promoStatus.ok ? "text-success-600" : "text-danger-600"}`}>
                                {promoStatus.message}
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {destination && mode && (
                <div className="absolute inset-x-0 bottom-16 px-4">
                  <Button size="lg" fullWidth variant={mode === "custom" ? "gold" : "primary"} onClick={confirmBooking} disabled={submitting}>
                    {submitting
                      ? "Sending…"
                      : mode === "custom"
                        ? `Send offer · ${formatMoney(customFare, selectedFare?.currencyCode ?? city?.currencyCode ?? null, locale)}`
                        : `Confirm Quick Match · ${selectedFare ? formatMoney(selectedFare.suggestedFare, selectedFare.currencyCode, locale) : ""}`}
                  </Button>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-ink-900/[0.06] bg-white/95 py-3 backdrop-blur">
                {[
                  { icon: HomeIcon, label: t("nav.home"), active: true, onClick: () => {} },
                  { icon: Clock, label: t("nav.activity"), onClick: () => {} },
                  { icon: Wallet, label: t("nav.wallet"), onClick: () => setView("wallet") },
                  { icon: User, label: t("nav.profile"), onClick: () => {} },
                ].map((t) => (
                  <button key={t.label} onClick={t.onClick} className={`flex flex-col items-center gap-0.5 ${t.active ? "text-rivo-600" : "text-ink-700/50"}`}>
                    <t.icon className="h-5 w-5" />
                    <span className="text-[10px] font-semibold">{t.label}</span>
                  </button>
                ))}
              </div>
            </>
          ))}
      </div>
    </div>
  )
}
