import { NavLink, Route, HashRouter as Router, Routes } from "react-router-dom"
import { Landing } from "./pages/Landing"
import { CustomerHome } from "./pages/passenger/CustomerHome"
import { DriverHome } from "./pages/driver/DriverHome"
import { AdminDashboard } from "./pages/admin/AdminDashboard"
import { Login } from "./pages/auth/Login"
import { RegisterPassenger } from "./pages/auth/RegisterPassenger"
import { RegisterDriver } from "./pages/auth/RegisterDriver"
import { Logo } from "./components/Logo"
import { AuthProvider, useAuth } from "./auth/AuthContext"
import { FeatureFlagsProvider } from "./featureFlags/FeatureFlagsContext"
import { ProtectedRoute } from "./auth/ProtectedRoute"
import { ToastProvider } from "./shared/Toast"
import { LocaleProvider } from "./i18n"

const previewLinks = [
  { to: "/", label: "Landing" },
  { to: "/app", label: "Customer App" },
  { to: "/driver", label: "Driver App" },
  { to: "/admin", label: "Admin Dashboard" },
]

function PreviewSwitcher() {
  const { user, logout } = useAuth()
  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-ink-900/10 bg-ink-900/95 px-3 py-2 text-white backdrop-blur">
      <Logo variant="mark" className="shrink-0" />
      <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-wide text-white/40 sm:inline">
        Phase 2 preview
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
      {user ? (
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className="hidden text-white/60 sm:inline">{user.fullName} · {user.role}</span>
          <button onClick={() => logout()} className="rounded-lg bg-white/10 px-2.5 py-1.5 font-semibold hover:bg-white/20">
            Log out
          </button>
        </div>
      ) : (
        <NavLink to="/login" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20">
          Log in
        </NavLink>
      )}
    </div>
  )
}

function AppRoutes() {
  return (
    <>
      <PreviewSwitcher />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register/passenger" element={<RegisterPassenger />} />
        <Route path="/register/driver" element={<RegisterDriver />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute roles={["passenger"]}>
              <CustomerHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/driver"
          element={
            <ProtectedRoute roles={["driver"]}>
              <DriverHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <FeatureFlagsProvider>
            <Router>
              <AppRoutes />
            </Router>
          </FeatureFlagsProvider>
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>
  )
}
