import { useEffect, useState } from "react"
import { Users, Car, TrendingUp } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import type { City, PassengerAnalytics, DriverAnalytics, MarketplaceAnalytics } from "../../types"

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-700/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-700/50">{hint}</p>}
    </Card>
  )
}

function DistributionBars({ items, labelKey }: { items: { count: number; [k: string]: unknown }[]; labelKey: string }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={String(i[labelKey])} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-xs font-semibold capitalize text-ink-700/70">{String(i[labelKey]).replace(/_/g, " ")}</span>
          <div className="h-2 flex-1 rounded-full bg-ink-900/[0.06]">
            <div className="h-2 rounded-full bg-rivo-500" style={{ width: `${Math.max(4, (i.count / max) * 100)}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-xs font-bold">{i.count}</span>
        </div>
      ))}
    </div>
  )
}

export function PlatformAnalyticsPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [cityId, setCityId] = useState("")
  const [passengers, setPassengers] = useState<PassengerAnalytics | null>(null)
  const [drivers, setDrivers] = useState<DriverAnalytics | null>(null)
  const [marketplace, setMarketplace] = useState<MarketplaceAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.cities().then((r) => setCities(r.cities))
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      adminApi.passengerAnalytics(cityId || undefined),
      adminApi.driverAnalytics(cityId || undefined),
      adminApi.marketplaceAnalytics(cityId || undefined),
    ])
      .then(([p, d, m]) => { setPassengers(p); setDrivers(d); setMarketplace(m) })
      .catch((err) => push("error", errorMessage(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Analytics</h1>
          <p className="text-sm text-ink-700/60">Passenger, driver, and marketplace metrics — live from the database</p>
        </div>
        <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading || !passengers || !drivers || !marketplace ? (
        <LoadingState label="Loading analytics…" />
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Marketplace</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="GBV" value={formatMoney(marketplace.grossBookingValueRs, null)} />
              <Stat label="Platform revenue" value={formatMoney(marketplace.platformRevenueRs, null)} />
              <Stat label="Take rate" value={`${marketplace.takeRatePct}%`} />
              <Stat label="Completed rides" value={String(marketplace.completedRides)} />
              <Stat label="Cancelled rides" value={String(marketplace.cancelledRides)} />
              <Stat label="Cancellation rate" value={`${marketplace.cancellationRatePct}%`} />
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <p className="mb-3 text-sm font-bold">Rides by booking mode</p>
                <DistributionBars items={marketplace.ridesByBookingMode} labelKey="bookingMode" />
              </Card>
              <Card className="p-4">
                <p className="mb-3 text-sm font-bold">Rides by payment method</p>
                <DistributionBars items={marketplace.ridesByPaymentMethod} labelKey="paymentMethod" />
              </Card>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Passengers</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total" value={String(passengers.totalPassengers)} />
              <Stat label="Activated" value={String(passengers.passengersWithAtLeastOneRide)} hint={`${passengers.activationRatePct}% activation`} />
              <Stat label="Avg rides / passenger" value={String(passengers.avgCompletedRidesPerPassenger)} />
              <Stat label="Avg rating given" value={passengers.avgRatingGiven.toFixed(2)} />
              <Stat label="With wallet balance" value={String(passengers.passengersWithWalletBalance)} />
              <Stat label="Successful referrals" value={String(passengers.successfulReferrals)} />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Car className="h-4 w-4 text-rivo-600" />
              <p className="text-sm font-bold">Drivers</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total" value={String(drivers.totalDrivers)} />
              <Stat label="Activated" value={String(drivers.driversWithAtLeastOneRide)} hint={`${drivers.activationRatePct}% activation`} />
              <Stat label="Online now" value={String(drivers.onlineNow)} />
              <Stat label="Avg acceptance" value={`${drivers.avgAcceptanceRatePct}%`} />
              <Stat label="Avg cancellation" value={`${drivers.avgCancellationRatePct}%`} />
              <Stat label="Avg rating" value={drivers.avgRating.toFixed(2)} />
              <Stat label="Total payouts" value={formatMoney(drivers.totalDriverPayoutsRs, null)} />
              <Stat label="Avg payout / ride" value={formatMoney(drivers.avgPayoutPerRideRs, null)} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
