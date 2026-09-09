import { NavLink, Route, HashRouter as Router, Routes } from "react-router-dom"
import { Landing } from "./pages/Landing"
import { CustomerHome } from "./pages/CustomerHome"
import { DriverHome } from "./pages/DriverHome"
import { AdminDashboard } from "./pages/AdminDashboard"
import { Logo } from "./components/Logo"

const previewLinks = [
  { to: "/", label: "Landing" },
  { to: "/app", label: "Customer App" },
  { to: "/driver", label: "Driver App" },
  { to: "/admin", label: "Admin Dashboard" },
]

function PreviewSwitcher() {
  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-ink-900/10 bg-ink-900/95 px-3 py-2 text-white backdrop-blur">
      <Logo variant="mark" className="shrink-0" />
      <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-wide text-white/40 sm:inline">
        Phase 1 preview
      </span>
      <nav className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {previewLinks.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/"}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive ? "bg-white text-ink-900" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <Router>
      <PreviewSwitcher />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<CustomerHome />} />
        <Route path="/driver" element={<DriverHome />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </Router>
  )
}
