import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Mail, Phone, ShieldCheck, User, Lock, Car } from "lucide-react"
import { Logo } from "../../components/Logo"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { authApi } from "../../api/auth"
import { publicApi } from "../../api/public"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"
import type { City, VehicleType } from "../../types"

export function RegisterDriver() {
  const [step, setStep] = useState<"form" | "otp">("form")
  const [cities, setCities] = useState<City[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([])
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [cityId, setCityId] = useState("")
  const [vehicleTypeCode, setVehicleTypeCode] = useState("")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [color, setColor] = useState("")
  const [plateNumber, setPlateNumber] = useState("")
  const [otpRequestId, setOtpRequestId] = useState("")
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { setUserAfterVerification } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    publicApi.cities().then((r) => {
      setCities(r.cities)
      if (r.cities[0]) setCityId(r.cities[0].id)
    })
    publicApi.vehicleTypes().then((r) => {
      setVehicleTypes(r.vehicleTypes)
      if (r.vehicleTypes[0]) setVehicleTypeCode(r.vehicleTypes[0].code)
    })
  }, [])

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.registerDriver({
        fullName, phone, email, password, cityId,
        vehicle: { vehicleTypeCode, make, model, color: color || undefined, plateNumber },
      })
      setOtpRequestId(result.otp.requestId)
      if (result.otp.devCode) setCode(result.otp.devCode)
      setStep("otp")
      push("info", result.note)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.verifyOtp(otpRequestId, code)
      if (result.user && result.accessToken && result.refreshToken) {
        setUserAfterVerification(result.user, result.accessToken, result.refreshToken)
        push("success", "Phone verified. Your documents are now awaiting admin approval.")
        navigate("/driver", { replace: true })
      }
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-41px)] items-center justify-center bg-[#F6F5FB] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-6">
          {step === "form" ? (
            <>
              <h1 className="font-display text-xl font-bold">Drive with RIVO</h1>
              <p className="mt-1 text-sm text-ink-700/60">Accept fares you like, counter the ones you don't.</p>
              <form onSubmit={onRegister} className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Full name" name="fullName" icon={<User className="h-4 w-4" />} value={fullName} onChange={(e) => setFullName(e.target.value)} required className="col-span-2" />
                  <Input label="Phone number" name="phone" type="tel" icon={<Phone className="h-4 w-4" />} placeholder="+923001234567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                  <Input label="Email" name="email" type="email" icon={<Mail className="h-4 w-4" />} value={email} onChange={(e) => setEmail(e.target.value)} required />
                  <Input label="Password" name="password" type="password" icon={<Lock className="h-4 w-4" />} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required className="col-span-2" />
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-700">City</span>
                  <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3.5 text-sm outline-none focus:border-rivo-500 focus:ring-2 focus:ring-rivo-500/15">
                    {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>

                <div className="rounded-xl border border-ink-900/10 p-3.5">
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700/50">
                    <Car className="h-3.5 w-3.5" /> Vehicle
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block col-span-2">
                      <span className="mb-1.5 block text-xs font-semibold text-ink-700">Vehicle type</span>
                      <select value={vehicleTypeCode} onChange={(e) => setVehicleTypeCode(e.target.value)} className="h-11 w-full rounded-xl border border-ink-900/10 bg-white px-3.5 text-sm outline-none focus:border-rivo-500 focus:ring-2 focus:ring-rivo-500/15">
                        {vehicleTypes.map((v) => <option key={v.id} value={v.code}>{v.name}</option>)}
                      </select>
                    </label>
                    <Input label="Make" name="make" placeholder="Toyota" value={make} onChange={(e) => setMake(e.target.value)} required />
                    <Input label="Model" name="model" placeholder="Corolla" value={model} onChange={(e) => setModel(e.target.value)} required />
                    <Input label="Color" name="color" placeholder="White" value={color} onChange={(e) => setColor(e.target.value)} />
                    <Input label="Plate number" name="plateNumber" placeholder="ICT-1234" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} required />
                  </div>
                </div>

                <Button type="submit" fullWidth size="lg" variant="gold" disabled={submitting}>
                  {submitting ? "Creating account…" : "Continue"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rivo-600/10 text-rivo-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h1 className="mt-3 font-display text-xl font-bold">Verify your phone</h1>
              <p className="mt-1 text-sm text-ink-700/60">Enter the 6-digit code sent to {phone}.</p>
              <form onSubmit={onVerify} className="mt-5 space-y-4">
                <Input label="Verification code" name="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
                <Button type="submit" fullWidth size="lg" disabled={submitting}>
                  {submitting ? "Verifying…" : "Verify & continue"}
                </Button>
              </form>
            </>
          )}

          <p className="mt-5 text-center text-sm text-ink-700/60">
            Already have an account? <Link to="/login" className="font-semibold text-rivo-600">Log in</Link>
          </p>
        </Card>
      </div>
    </div>
  )
}
