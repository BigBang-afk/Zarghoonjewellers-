import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Lock, Phone } from "lucide-react"
import { Logo } from "../../components/Logo"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"

const DEMO_ACCOUNTS = [
  { label: "Passenger", phone: "+923001000001", password: "Passenger123!" },
  { label: "Driver", phone: "+923002000001", password: "Driver123!" },
  { label: "Admin", phone: "+923000000001", password: "Admin123!" },
]

export function Login() {
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const user = await login(phone, password)
      const dest = location.state?.from ?? (user.role === "passenger" ? "/app" : user.role === "driver" ? "/driver" : "/admin")
      navigate(dest, { replace: true })
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-41px)] items-center justify-center bg-[#F6F5FB] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-6">
          <h1 className="font-display text-xl font-bold">Log in</h1>
          <p className="mt-1 text-sm text-ink-700/60">Works for passengers, drivers, and admins.</p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <Input label="Phone number" name="phone" type="tel" icon={<Phone className="h-4 w-4" />} placeholder="+923001234567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <Input label="Password" name="password" type="password" icon={<Lock className="h-4 w-4" />} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="submit" fullWidth size="lg" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>

          <div className="mt-5 rounded-xl bg-ink-900/[0.03] p-3.5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-700/50">Demo accounts (seed data)</p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setPhone(a.phone)
                    setPassword(a.password)
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white"
                >
                  <span className="font-semibold">{a.label}</span>
                  <span className="text-ink-700/50">{a.phone}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-5 text-center text-sm text-ink-700/60">
            New to RIVO?{" "}
            <Link to="/register/passenger" className="font-semibold text-rivo-600">Ride with us</Link>
            {" · "}
            <Link to="/register/driver" className="font-semibold text-rivo-600">Drive with us</Link>
          </p>
        </Card>
      </div>
    </div>
  )
}
