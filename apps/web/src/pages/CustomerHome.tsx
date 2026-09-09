import { useState } from "react"
import {
  Bell,
  Briefcase,
  Clock,
  Home as HomeIcon,
  Minus,
  Navigation,
  Plus,
  Search,
  User,
  Wallet,
  Zap,
} from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../components/ui/MapCanvas"
import { Card } from "../components/ui/Card"
import { Button } from "../components/ui/Button"
import { VehicleIcon } from "../components/VehicleIcon"
import {
  currentCity,
  recentDestinations,
  savedPlaces,
  vehicleTypes,
  type VehicleTypeId,
} from "../data/mock"

export function CustomerHome() {
  const [destination, setDestination] = useState<string | null>(null)
  const [vehicleId, setVehicleId] = useState<VehicleTypeId>("economy")
  const [mode, setMode] = useState<"quick" | "custom" | null>(null)
  const [customFare, setCustomFare] = useState(500)

  const vehicle = vehicleTypes.find((v) => v.id === vehicleId)!

  return (
    <div className="flex justify-center bg-[#EDEBFB] py-0 sm:py-6">
      <div className="relative flex h-[calc(100vh-41px)] w-full max-w-md flex-col overflow-hidden bg-[#F6F5FB] sm:h-[840px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink-900 sm:shadow-rivo-lg">
        {/* Map */}
        <MapCanvas className="relative h-[42%] shrink-0">
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
            <div className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-rivo-sm">
              <span className="h-2 w-2 rounded-full bg-success-500" />
              <span className="text-xs font-semibold">{currentCity.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-rivo-sm">
                <Bell className="h-4 w-4" />
              </button>
              <button className="flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 shadow-rivo-sm">
                <Wallet className="h-3.5 w-3.5 text-rivo-600" />
                <span className="text-xs font-bold">Rs 2,450</span>
              </button>
            </div>
          </div>

          <Pin x={48} y={58} variant="you" />
          <CarMarker x={30} y={35} rotate={-15} />
          <CarMarker x={68} y={70} rotate={30} />
          <CarMarker x={20} y={68} rotate={5} />

          <div className="absolute bottom-3 right-3 flex flex-col gap-2">
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Plus className="h-4 w-4" /></button>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Minus className="h-4 w-4" /></button>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-rivo-sm"><Navigation className="h-4 w-4 text-rivo-600" /></button>
          </div>
        </MapCanvas>

        {/* Sheet */}
        <div className="-mt-5 flex flex-1 flex-col overflow-y-auto rounded-t-[1.75rem] bg-[#F6F5FB] px-4 pb-24 pt-4 scrollbar-none">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-900/10" />

          <button
            onClick={() => setDestination((d) => d ?? recentDestinations[0].title)}
            className="flex w-full items-center gap-3 rounded-2xl border border-ink-900/10 bg-white px-4 py-3.5 text-left shadow-rivo-sm"
          >
            <Search className="h-4 w-4 text-ink-700/50" />
            <span className={destination ? "font-semibold text-ink-900" : "text-ink-700/50"}>
              {destination ?? "Where to?"}
            </span>
          </button>

          {/* Saved places */}
          <div className="mt-4 flex gap-3">
            {savedPlaces.map((p) => (
              <button
                key={p.id}
                onClick={() => setDestination(p.address)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 text-left shadow-rivo-sm"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rivo-600/10 text-rivo-600">
                  {p.icon === "home" ? <HomeIcon className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold">{p.label}</p>
                  <p className="truncate text-[10px] text-ink-700/60">{p.address}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Recent destinations */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-700/50">Recent</p>
            <div className="space-y-1">
              {recentDestinations.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setDestination(r.title)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${destination === r.title ? "bg-rivo-600/10" : "hover:bg-white"}`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900/[0.05]">
                    <Clock className="h-4 w-4 text-ink-700/60" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.title}</p>
                    <p className="truate text-xs text-ink-700/60">{r.subtitle}</p>
                  </div>
                  <span className="text-xs text-ink-700/50">{r.distanceKm} km</span>
                </button>
              ))}
            </div>
          </div>

          {/* Vehicle options */}
          {destination && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-700/50">Choose a ride</p>
              <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
                {vehicleTypes.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVehicleId(v.id)}
                    className={`flex w-[104px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 transition-colors ${
                      vehicleId === v.id ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10 bg-white"
                    }`}
                  >
                    <VehicleIcon type={v.id} className="h-6 w-6 text-ink-900" />
                    <span className="text-xs font-bold">{v.name}</span>
                    <span className="text-[10px] text-ink-700/60">{v.eta}</span>
                    <span className="text-xs font-extrabold text-rivo-600">Rs {v.suggestedFare}</span>
                  </button>
                ))}
              </div>

              {/* Mode selection */}
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
                  onClick={() => setMode("custom")}
                  className={`rounded-2xl border p-3.5 text-left transition-colors ${mode === "custom" ? "border-gold-500 bg-gold-400/10" : "border-ink-900/10 bg-white"}`}
                >
                  <span className="font-display text-sm font-extrabold text-gold-600">Rs</span>
                  <p className="mt-2 text-sm font-bold">Set Your Price</p>
                  <p className="text-[11px] text-ink-700/60">Drivers bid on your fare</p>
                </button>
              </div>

              {mode === "custom" && (
                <Card className="mt-3 flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs text-ink-700/60">Your offer</p>
                    <p className="font-display text-2xl font-extrabold">Rs {customFare}</p>
                    <p className="text-[11px] text-ink-700/50">Suggested: Rs {vehicle.suggestedFare}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCustomFare((f) => Math.max(100, f - 20))} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.06]">
                      <Minus className="h-4 w-4" />
                    </button>
                    <button onClick={() => setCustomFare((f) => f + 20)} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.06]">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Sticky CTA */}
        {destination && mode && (
          <div className="absolute inset-x-0 bottom-16 px-4">
            <Button size="lg" fullWidth variant={mode === "custom" ? "gold" : "primary"}>
              {mode === "custom" ? `Send offer · Rs ${customFare}` : `Confirm Quick Match · Rs ${vehicle.suggestedFare}`}
            </Button>
          </div>
        )}

        {/* Bottom tab bar */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-ink-900/[0.06] bg-white/95 py-3 backdrop-blur">
          {[
            { icon: HomeIcon, label: "Home", active: true },
            { icon: Clock, label: "Activity" },
            { icon: Wallet, label: "Wallet" },
            { icon: User, label: "Profile" },
          ].map((t) => (
            <button key={t.label} className={`flex flex-col items-center gap-0.5 ${t.active ? "text-rivo-600" : "text-ink-700/50"}`}>
              <t.icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
