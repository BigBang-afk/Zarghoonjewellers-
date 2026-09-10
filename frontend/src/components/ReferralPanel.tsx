import { useEffect, useState } from "react"
import { ArrowLeft, Copy, Gift, Share2 } from "lucide-react"
import { Card } from "./ui/Card"
import { Badge } from "./ui/Badge"
import { Button } from "./ui/Button"
import { LoadingState } from "./ui/States"
import { accountApi } from "../api/account"
import { useToast, errorMessage } from "../shared/Toast"
import { formatMoney } from "../shared/money"
import { useLocale } from "../i18n"
import type { ReferralSummary } from "../types"

/**
 * Referral code + status, shared between passenger and driver home
 * screens (Phase 5 §6/§7 — referral qualification and rewards are
 * role-agnostic on the backend; the app-side view was the missing
 * piece). Also lets a user apply a code post-signup, since neither
 * registration form currently collects one.
 */
export function ReferralPanel({ onClose }: { onClose: () => void }) {
  const { push } = useToast()
  const { locale } = useLocale()
  const [summary, setSummary] = useState<ReferralSummary | null>(null)
  const [applyCode, setApplyCode] = useState("")
  const [applying, setApplying] = useState(false)

  async function load() {
    try {
      const res = await accountApi.referral()
      setSummary(res)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function copyCode() {
    if (!summary?.code) return
    navigator.clipboard?.writeText(summary.code).then(
      () => push("success", "Referral code copied."),
      () => push("error", "Couldn't copy — copy it manually."),
    )
  }

  async function share() {
    if (!summary?.code) return
    const text = `Join RIVO with my referral code ${summary.code} and we both get a bonus!`
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        // user cancelled the share sheet — not an error
      }
    } else {
      copyCode()
    }
  }

  async function submitApply() {
    if (!applyCode.trim()) return
    setApplying(true)
    try {
      await accountApi.applyReferralCode(applyCode.trim())
      push("success", "Referral code applied!")
      setApplyCode("")
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <p className="font-display text-lg font-bold">Refer & earn</p>
      </div>

      {!summary ? (
        <LoadingState label="Loading your referral status…" />
      ) : (
        <>
          <Card className="flex items-center gap-3 rounded-2xl bg-rivo-600 p-5 text-white shadow-rivo-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
              <Gift className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-white/70">Your referral code</p>
              <p className="font-display text-2xl font-extrabold tracking-wide">{summary.code ?? "—"}</p>
            </div>
          </Card>

          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" />} onClick={copyCode} disabled={!summary.code}>
              Copy code
            </Button>
            <Button variant="primary" size="sm" icon={<Share2 className="h-4 w-4" />} onClick={share} disabled={!summary.code}>
              Share
            </Button>
          </div>

          <Card className="mt-4 p-4">
            <p className="text-xs text-ink-700/60">Total earned from referrals</p>
            <p className="mt-1 font-display text-xl font-extrabold text-rivo-600">{formatMoney(summary.totalRewardedRs, summary.currencyCode, locale)}</p>
          </Card>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Have a code from someone else?</p>
          <div className="flex gap-2">
            <input
              className="h-10 flex-1 rounded-xl border border-ink-900/10 bg-white px-3 text-sm outline-none focus:border-rivo-500"
              placeholder="Enter referral code"
              value={applyCode}
              onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
            />
            <Button variant="secondary" size="sm" onClick={submitApply} disabled={applying || !applyCode.trim()}>
              {applying ? "…" : "Apply"}
            </Button>
          </div>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">People you've referred</p>
          {summary.referralsMade.length === 0 ? (
            <p className="text-sm text-ink-700/50">Nobody has signed up with your code yet.</p>
          ) : (
            <div className="space-y-2">
              {summary.referralsMade.map((r) => (
                <Card key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{r.referredName}</p>
                    <p className="text-[11px] text-ink-700/50">{new Date(r.createdAt).toLocaleDateString(locale)}</p>
                  </div>
                  <Badge tone={r.status === "rewarded" ? "success" : "warning"}>
                    {r.status === "rewarded" ? `+${formatMoney(r.rewardAmountReferrer ?? 0, summary.currencyCode, locale)}` : "Pending first ride"}
                  </Badge>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
