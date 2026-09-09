import { useState } from "react"
import {
  Banknote,
  Bell,
  Clock,
  MapPin,
  Navigation,
  Power,
  Route,
  Star,
  TrendingUp,
  User,
  Wallet,
  X,
} from "lucide-react"
import { MapCanvas, MapPin as Pin, CarMarker } from "../components/ui/MapCanvas"
import { Card } from "../components/ui/Card"
import { Button } from "../components/ui/Button"
import { Badge } from "../components/ui/Badge"
import { driverEarningsToday, driverIncomingRequest as req } from "../data/mock"

export function DriverHome() {
  const [online, setOnline] = useState(true)
  const [requestOpen, setRequestOpen] = useState(true)
  const [counterMode, setCounterMode] = useState(false)
  const [counterFare, setCounterFare] = useState(req.proposedFare + 50)
  const [decision, setDecision] = useState<null | "accepted" | "countered" | "declined">(null)

  return (
    <div className="flex justify-center bg-[#EDEBFB] py-0 sm:py-6">
      <div className="relative flex h-[calc(100vh-41px)] w-full max-w-md flex-col overflow-hidden bg-[#F6F5FB] sm:h-[840px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink-900 sm:shadow-rivo-lg">
        {/* Map */}
        <MapCanvas className="relative flex-1">
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4">
            <div className="flex items-center gap-2.5 rounded-full bg-white/95 py-1.5 pl-1.5 pr-3 shadow-rivo-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rivo-600 text-xs font-bold text-white">AR</div>
              <div className="leading-tight">
                <p className="text-xs font-bold">Ahmed Raza</p>
                <div className="flex items-center gap-1 text-[10px] text-ink-700/60">
                  <Star className="h-2.5 w-2.5 fill-gold-400 text-gold-400" /> 4.92
                </div>
              </div>
            </div>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow-rivo-sm">
              <Bell className="h-4 w-4" />
            </button>
          </div>

          <Pin x={50} y={55} variant="you" />
          <CarMarker x={30} y={30} rotate={10} />
          <CarMarker x={72} y={38} rotate={-20} />

          {/* Availability toggle */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <button
              onClick={() => setOnline((v) => !v)}
              className={`flex items-center gap-2.5 rounded-full px-5 py-3 shadow-rivo-lg transition-colors ${
                online ? "bg-success-500 text-white" : "bg-ink-900 text-white"
              }`}
            >
              <Power className="h-4 w-4" />
              <span className="text-sm font-bold">{online ? "You're online" : "You're offline"}</span>
              <span className={`ml-1 h-2 w-2 rounded-full ${online ? "bg-white animate-pulse" : "bg-white/40"}`} />
            </button>
          </div>
        </MapCanvas>

        {/* Earnings strip */}
        <div className="grid grid-cols-4 gap-2 border-t border-ink-900/[0.06] bg-white px-4 py-3">
          {[
            { label: "Today", value: `Rs ${driverEarningsToday.totalRs.toLocaleString()}`, icon: Wallet },
            { label: "Rides", value: driverEarningsToday.rides, icon: Route },
            { label: "Online", value: `${driverEarningsToday.onlineHours}h`, icon: Clock },
            { label: "Rating", value: driverEarningsToday.rating, icon: Star },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-0.5">
              <s.icon className="h-3.5 w-3.5 text-rivo-600" />
              <span className="text-xs font-extrabold">{s.value}</span>
              <span className="text-[9px] text-ink-700/50">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Bottom tab bar */}
        <div className="flex items-center justify-around border-t border-ink-900/[0.06] bg-white py-3">
          {[
            { icon: Navigation, label: "Home", active: true },
            { icon: TrendingUp, label: "Earnings" },
            { icon: Banknote, label: "Wallet" },
            { icon: User, label: "Profile" },
          ].map((t) => (
            <button key={t.label} className={`flex flex-col items-center gap-0.5 ${t.active ? "text-rivo-600" : "text-ink-700/50"}`}>
              <t.icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Incoming request sheet */}
        {online && requestOpen && (
          <div className="absolute inset-x-0 bottom-0 top-0 flex items-end bg-ink-900/40 p-3">
            <Card className="w-full p-4">
              {decision === null ? (
                <>
                  <div className="flex items-center justify-between">
                    <Badge tone="brand" dot>New ride request</Badge>
                    <button onClick={() => setRequestOpen(false)} className="text-ink-700/50"><X className="h-4 w-4" /></button>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-900/[0.06] text-sm font-bold">SM</div>
                    <div>
                      <p className="text-sm font-bold">{req.passengerName}</p>
                      <div className="flex items-center gap-1 text-xs text-ink-700/60">
                        <Star className="h-3 w-3 fill-gold-400 text-gold-400" /> {req.passengerRating}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-[10px] text-ink-700/50">Requested fare</p>
                      <p className="font-display text-xl font-extrabold text-rivo-600">Rs {req.proposedFare}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 rounded-xl bg-ink-900/[0.03] p-3">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rivo-600" />
                      <span className="font-medium">{req.pickup}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-900" />
                      <span className="font-medium">{req.destination}</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    <div><p className="font-bold">{req.distanceKm} km</p><p className="text-[10px] text-ink-700/50">Distance</p></div>
                    <div><p className="font-bold">{req.estMinutes} min</p><p className="text-[10px] text-ink-700/50">Trip time</p></div>
                    <div><p className="font-bold">{req.vehicleRequirement}</p><p className="text-[10px] text-ink-700/50">Vehicle</p></div>
                    <div><p className="font-bold">{req.paymentMethod}</p><p className="text-[10px] text-ink-700/50">Payment</p></div>
                  </div>

                  {!counterMode ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Button variant="danger" onClick={() => setDecision("declined")}>Decline</Button>
                      <Button variant="secondary" onClick={() => setCounterMode(true)}>Counter</Button>
                      <Button variant="primary" onClick={() => setDecision("accepted")}>Accept</Button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-ink-900/10 p-3">
                      <p className="text-xs font-semibold text-ink-700/70">Your counter-offer</p>
                      <div className="mt-2 flex items-center justify-between">
                        <button onClick={() => setCounterFare((f) => Math.max(100, f - 20))} className="h-9 w-9 rounded-full bg-ink-900/[0.06] font-bold">–</button>
                        <span className="font-display text-2xl font-extrabold">Rs {counterFare}</span>
                        <button onClick={() => setCounterFare((f) => f + 20)} className="h-9 w-9 rounded-full bg-ink-900/[0.06] font-bold">+</button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => setCounterMode(false)}>Back</Button>
                        <Button variant="gold" onClick={() => setDecision("countered")}>Send counter</Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  {decision === "accepted" && (
                    <>
                      <Badge tone="success">Ride accepted</Badge>
                      <p className="mt-1 text-sm text-ink-700">Head to pickup — {req.pickup}</p>
                    </>
                  )}
                  {decision === "countered" && (
                    <>
                      <Badge tone="warning">Counter-offer sent · Rs {counterFare}</Badge>
                      <p className="mt-1 text-sm text-ink-700">Waiting for {req.passengerName} to respond…</p>
                    </>
                  )}
                  {decision === "declined" && (
                    <>
                      <Badge tone="danger">Request declined</Badge>
                      <p className="mt-1 text-sm text-ink-700">You won't be matched to this request.</p>
                    </>
                  )}
                  <Button
                    className="mt-3"
                    variant="ghost"
                    onClick={() => {
                      setDecision(null)
                      setCounterMode(false)
                      setRequestOpen(false)
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {online && !requestOpen && (
          <button
            onClick={() => {
              setRequestOpen(true)
              setDecision(null)
              setCounterMode(false)
            }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-xs font-semibold text-white shadow-rivo-md"
          >
            Simulate incoming request
          </button>
        )}
      </div>
    </div>
  )
}
