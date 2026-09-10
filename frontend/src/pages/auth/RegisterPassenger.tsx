import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Mail, Phone, ShieldCheck, User, Lock, Gift } from "lucide-react"
import { Logo } from "../../components/Logo"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { authApi } from "../../api/auth"
import { useAuth } from "../../auth/AuthContext"
import { useToast, errorMessage } from "../../shared/Toast"

export function RegisterPassenger() {
  const [step, setStep] = useState<"form" | "otp">("form")
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [referredByCode, setReferredByCode] = useState("")
  const [otpRequestId, setOtpRequestId] = useState("")
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { setUserAfterVerification } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()

  async function onRegister(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.registerPassenger({ fullName, phone, email: email || undefined, password, referredByCode: referredByCode.trim() || undefined })
      setOtpRequestId(result.otp.requestId)
      if (result.otp.devCode) setCode(result.otp.devCode)
      setStep("otp")
      push("info", "Verification code sent. (Dev mode: pre-filled below.)")
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
        push("success", "Welcome to RIVO!")
        navigate("/app", { replace: true })
      }
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
          {step === "form" ? (
            <>
              <h1 className="font-display text-xl font-bold">Create your passenger account</h1>
              <p className="mt-1 text-sm text-ink-700/60">Ride with RIVO — set your own price.</p>
              <form onSubmit={onRegister} className="mt-5 space-y-4">
                <Input label="Full name" name="fullName" icon={<User className="h-4 w-4" />} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                <Input label="Phone number" name="phone" type="tel" icon={<Phone className="h-4 w-4" />} placeholder="+923001234567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                <Input label="Email (optional)" name="email" type="email" icon={<Mail className="h-4 w-4" />} value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input label="Password" name="password" type="password" icon={<Lock className="h-4 w-4" />} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
                <Input
                  label="Referral code (optional)"
                  name="referredByCode"
                  icon={<Gift className="h-4 w-4" />}
                  value={referredByCode}
                  onChange={(e) => setReferredByCode(e.target.value.toUpperCase())}
                />
                <Button type="submit" fullWidth size="lg" disabled={submitting}>
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
