import {
  ArrowRight,
  Bike,
  Car,
  CarTaxiFront,
  CheckCircle2,
  Crown,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  Zap,
} from "lucide-react"
import { Logo } from "../components/Logo"
import { Button } from "../components/ui/Button"
import { Card } from "../components/ui/Card"
import { Badge } from "../components/ui/Badge"
import { MapCanvas, MapPin as Pin, CarMarker } from "../components/ui/MapCanvas"
import { Link } from "react-router-dom"

const vehicleRow = [
  { icon: Bike, name: "Bike" },
  { icon: CarTaxiFront, name: "Rickshaw" },
  { icon: Car, name: "Economy" },
  { icon: Car, name: "Standard" },
  { icon: Crown, name: "Premium" },
]

const stats = [
  { label: "Cities live", value: "3" },
  { label: "Verified drivers", value: "18,300+" },
  { label: "Rides completed", value: "2.1M+" },
  { label: "Avg. pickup time", value: "5.4 min" },
]

export function Landing() {
  return (
    <div className="min-h-screen bg-[#F6F5FB] text-ink-900">
      {/* Nav */}
      <header className="sticky top-[41px] z-40 border-b border-ink-900/[0.06] bg-[#F6F5FB]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-semibold text-ink-700 md:flex">
            <a href="#how-it-works" className="hover:text-ink-900">How it works</a>
            <a href="#vehicles" className="hover:text-ink-900">Vehicles</a>
            <a href="#safety" className="hover:text-ink-900">Safety</a>
            <a href="#drive" className="hover:text-ink-900">Drive with RIVO</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link to="/register/passenger"><Button variant="primary" size="sm" icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">Get the app</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-5 pt-14 pb-20 md:pt-20">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <Badge tone="brand" dot>Now live in Islamabad</Badge>
            <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-balance md:text-6xl">
              Your Ride.<br />
              <span className="text-rivo-600">Your Price.</span><br />
              Your Choice.
            </h1>
            <p className="mt-6 max-w-md text-lg text-ink-700">
              RIVO is the ride marketplace where you set the price. Get matched instantly,
              or put your fare out to nearby drivers and pick the best offer.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/app">
                <Button size="lg" icon={<Zap className="h-5 w-5" />}>Book a ride</Button>
              </Link>
              <a href="#drive">
                <Button size="lg" variant="secondary">Drive with RIVO</Button>
              </a>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <div className="font-display text-2xl font-extrabold">{s.value}</div>
                  <div className="text-xs font-medium text-ink-700/70">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Phone mock */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-rivo-500/10 blur-2xl" />
            <div className="rounded-[2.5rem] border-8 border-ink-900 bg-ink-900 shadow-rivo-lg">
              <div className="overflow-hidden rounded-[1.9rem]">
                <MapCanvas className="h-[420px] w-full">
                  <Pin x={30} y={62} variant="pickup" />
                  <Pin x={72} y={24} variant="destination" label="Centaurus Mall" />
                  <CarMarker x={45} y={45} rotate={20} />
                  <CarMarker x={58} y={70} rotate={-10} />
                  <div className="absolute inset-x-3 bottom-3">
                    <Card className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-ink-700/70">Your offer</p>
                          <p className="font-display text-xl font-extrabold text-rivo-600">Rs 700</p>
                        </div>
                        <Badge tone="success" dot>3 offers in</Badge>
                      </div>
                    </Card>
                  </div>
                </MapCanvas>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y border-ink-900/[0.06] bg-white py-20">
        <div className="mx-auto max-w-7xl px-5">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">Two ways to ride</h2>
            <p className="mt-3 text-ink-700">
              RIVO isn't just another dispatch app. Choose the flow that fits the moment —
              both run on the same live marketplace of nearby drivers.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Card className="p-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rivo-600/10 text-rivo-600">
                <Zap className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-bold">Quick Match</h3>
              <p className="mt-2 text-sm text-ink-700">
                In a hurry? RIVO instantly finds and books the best available driver near you at a fair, suggested fare.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {["Set pickup & destination", "System suggests a fare", "Best nearby driver auto-matched", "Ride starts in minutes"].map((s) => (
                  <li key={s} className="flex items-center gap-2 text-ink-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success-500" /> {s}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-8 ring-1 ring-rivo-600/15">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-400/15 text-gold-600">
                <MessageCircle className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-bold">Competitive Offer</h3>
              <p className="mt-2 text-sm text-ink-700">
                Name your price. Nearby drivers accept or counter-offer — you compare and pick the best one.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {["Propose your own fare", "Drivers accept or counter", "Compare price, ETA & rating", "You choose your driver"].map((s) => (
                  <li key={s} className="flex items-center gap-2 text-ink-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success-500" /> {s}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* Vehicles */}
      <section id="vehicles" className="py-20">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">A ride for every trip</h2>
          <p className="mt-3 max-w-xl text-ink-700">From a quick bike hop to a premium ride, RIVO matches vehicle types to what you actually need.</p>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {vehicleRow.map((v) => (
              <Card key={v.name} className="flex flex-col items-center gap-3 p-6 text-center transition-shadow hover:shadow-rivo-md">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rivo-600/10 text-rivo-600">
                  <v.icon className="h-6 w-6" />
                </div>
                <span className="font-semibold">{v.name}</span>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Safety */}
      <section id="safety" className="border-y border-ink-900/[0.06] bg-ink-900 py-20 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 md:grid-cols-2">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-5 font-display text-3xl font-extrabold tracking-tight md:text-4xl">Built around your safety</h2>
            <p className="mt-3 max-w-md text-white/70">
              Every driver is document-verified. Every ride can be shared live with someone you trust,
              with one-tap emergency assistance built in.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-6">
              {["Verified drivers", "Live trip sharing", "In-app emergency SOS", "24/7 support escalation"].map((f) => (
                <div key={f} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
                  <span className="text-sm text-white/80">{f}</span>
                </div>
              ))}
            </div>
          </div>
          <MapCanvas tone="dark" className="h-72 rounded-3xl md:h-96">
            <Pin x={40} y={55} variant="you" />
            <Pin x={65} y={30} variant="destination" label="Sharing with Ayesha" />
          </MapCanvas>
        </div>
      </section>

      {/* Drive with RIVO */}
      <section id="drive" className="py-20">
        <div className="mx-auto max-w-7xl px-5">
          <Card className="grid items-center gap-8 overflow-hidden p-8 md:grid-cols-2 md:p-14">
            <div>
              <Badge tone="warning">Earn on your terms</Badge>
              <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight md:text-4xl">Drive with RIVO</h2>
              <p className="mt-3 max-w-md text-ink-700">
                Accept fares you like, counter the ones you don't. Transparent commission, fast weekly payouts.
              </p>
              <Link to="/register/driver" className="mt-6 inline-block">
                <Button size="lg" variant="gold">Start driving</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { k: "Avg. driver earnings", v: "Rs 68k/mo" },
                { k: "Platform commission", v: "As low as 15%" },
                { k: "Payout cycle", v: "Weekly" },
                { k: "Driver rating avg.", v: "4.86 ★" },
              ].map((s) => (
                <div key={s.k} className="rounded-xl bg-ink-900/[0.03] p-4">
                  <div className="font-display text-lg font-extrabold">{s.v}</div>
                  <div className="text-xs text-ink-700/70">{s.k}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-900/[0.06] bg-white py-12">
        <div className="mx-auto max-w-7xl px-5">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
            <div>
              <Logo />
              <p className="mt-3 max-w-xs text-sm text-ink-700/70">
                A ride marketplace connecting passengers with nearby drivers — one fair price at a time.
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-sm text-ink-700">
                <MapPin className="h-4 w-4" /> Islamabad, Pakistan
              </div>
            </div>
            <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
              <div>
                <p className="font-semibold">Company</p>
                <ul className="mt-3 space-y-2 text-ink-700/70">
                  <li>About RIVO</li><li>Cities</li><li>Careers</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold">Product</p>
                <ul className="mt-3 space-y-2 text-ink-700/70">
                  <li>Ride</li><li>Drive</li><li>Business</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold">Support</p>
                <ul className="mt-3 space-y-2 text-ink-700/70">
                  <li>Help center</li><li>Safety</li><li>Trust & privacy</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-10 flex items-center justify-between border-t border-ink-900/[0.06] pt-6 text-xs text-ink-700/60">
            <span>© 2026 RIVO Mobility Inc. All rights reserved.</span>
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-gold-400 text-gold-400" /> 4.8 average app rating
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
