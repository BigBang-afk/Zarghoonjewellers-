import { useEffect, useState } from "react"
import { Clock, Route, Star, Trophy, Wallet, Zap } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState } from "../../components/ui/States"
import { Button } from "../../components/ui/Button"
import { driverApi } from "../../api/driver"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { DriverEarningsSummary, DriverIncentiveSummary, PayoutRequest } from "../../types"

const PAYOUT_STATUS_LABEL: Record<PayoutRequest["status"], string> = {
  requested: "Requested",
  processing: "Processing",
  completed: "Paid out",
  failed: "Failed",
  cancelled: "Cancelled",
}

export function EarningsPanel() {
  const [data, setData] = useState<DriverEarningsSummary | null>(null)
  const [incentives, setIncentives] = useState<DriverIncentiveSummary | null>(null)
  const [payouts, setPayouts] = useState<PayoutRequest[]>([])
  const [payoutAmount, setPayoutAmount] = useState("")
  const [payoutMethod, setPayoutMethod] = useState<"card" | "local_provider">("local_provider")
  const [requesting, setRequesting] = useState(false)
  const { push } = useToast()
  const { locale } = useLocale()

  function loadPayouts() {
    driverApi.payouts().then((r) => setPayouts(r.payouts)).catch(() => {})
  }

  useEffect(() => {
    driverApi.earnings().then(setData).catch((err) => push("error", errorMessage(err)))
    driverApi.incentives().then(setIncentives).catch(() => {})
    loadPayouts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRequestPayout() {
    const amount = Number(payoutAmount)
    if (!amount || amount <= 0) {
      push("error", "Enter a valid amount.")
      return
    }
    setRequesting(true)
    try {
      await driverApi.requestPayout(amount, payoutMethod)
      push("success", "Payout requested.")
      setPayoutAmount("")
      loadPayouts()
      driverApi.earnings().then(setData).catch(() => {})
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setRequesting(false)
    }
  }

  async function handleCancelPayout(id: string) {
    try {
      await driverApi.cancelPayout(id)
      push("success", "Payout request cancelled.")
      loadPayouts()
      driverApi.earnings().then(setData).catch(() => {})
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  if (!data) return <LoadingState label="Loading earnings…" />

  const maxDaily = Math.max(1, ...data.charts.daily.map((d) => d.totalRs))
  const money = (amount: number) => formatMoney(amount, data.currencyCode, locale)

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <p className="font-display text-lg font-bold">Earnings</p>

      <Card className="mt-3 p-5">
        <p className="text-xs text-ink-700/60">Wallet balance</p>
        <p className="font-display text-3xl font-extrabold text-rivo-600">{money(data.walletBalanceRs)}</p>
        <div className="mt-3 flex gap-4 border-t border-ink-900/[0.06] pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Pending payout</p>
            <p className="text-sm font-bold">{money(data.pendingBalanceRs)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Lifetime paid out</p>
            <p className="text-sm font-bold">{money(data.paidBalanceRs)}</p>
          </div>
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          { label: "Today", v: data.today },
          { label: "This week", v: data.week },
          { label: "This month", v: data.month },
        ].map((p) => (
          <Card key={p.label} className="p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-700/50">{p.label}</p>
            <p className="mt-1 font-display text-base font-extrabold">{money(p.v.totalRs)}</p>
            <p className="text-[10px] text-ink-700/50">{p.v.rides} rides</p>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Card className="flex flex-col items-center gap-1 p-3">
          <Route className="h-4 w-4 text-rivo-600" />
          <p className="text-sm font-extrabold">{data.completedRides}</p>
          <p className="text-[10px] text-ink-700/50">Completed</p>
        </Card>
        <Card className="flex flex-col items-center gap-1 p-3">
          <Clock className="h-4 w-4 text-rivo-600" />
          <p className="text-sm font-extrabold">{data.acceptanceRate.toFixed(0)}%</p>
          <p className="text-[10px] text-ink-700/50">Acceptance</p>
        </Card>
        <Card className="flex flex-col items-center gap-1 p-3">
          <Star className="h-4 w-4 fill-gold-400 text-gold-400" />
          <p className="text-sm font-extrabold">{data.rating.toFixed(2)}</p>
          <p className="text-[10px] text-ink-700/50">Rating</p>
        </Card>
        <Card className="flex flex-col items-center gap-1 p-3">
          <Zap className="h-4 w-4 text-rivo-600" />
          <p className="text-sm font-extrabold">{money(data.earningsPerHourRs)}</p>
          <p className="text-[10px] text-ink-700/50">Per hour</p>
        </Card>
      </div>

      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Last 14 days</p>
      <Card className="flex items-end gap-1 p-4" style={{ height: 100 }}>
        {data.charts.daily.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${money(d.totalRs)} · ${d.rides} rides`}>
            <div className="w-full rounded-t bg-rivo-600/70" style={{ height: `${Math.max(4, (d.totalRs / maxDaily) * 64)}px` }} />
          </div>
        ))}
      </Card>

      {incentives && incentives.activeProgress.length > 0 && (
        <>
          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Active incentives</p>
          <div className="space-y-2">
            {incentives.activeProgress.map((p) => (
              <Card key={p.id} className="p-3.5">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-gold-500" />
                  <p className="text-sm font-bold">{p.campaign.name}</p>
                </div>
                <p className="mt-1 text-[11px] text-ink-700/60">
                  {p.currentCount}/{p.campaign.targetRideCount} rides · {money(p.campaign.rewardAmount)} reward
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
                  <div
                    className="h-full rounded-full bg-gold-400"
                    style={{ width: `${Math.min(100, (p.currentCount / p.campaign.targetRideCount) * 100)}%` }}
                  />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Withdraw earnings</p>
      <Card className="p-4">
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            placeholder="Amount"
            value={payoutAmount}
            onChange={(e) => setPayoutAmount(e.target.value)}
            max={data.walletBalanceRs}
            className="h-11 flex-1 rounded-xl border border-ink-900/10 bg-white px-3 text-sm outline-none focus:border-rivo-500"
          />
          <select
            value={payoutMethod}
            onChange={(e) => setPayoutMethod(e.target.value as "card" | "local_provider")}
            className="h-11 rounded-xl border border-ink-900/10 bg-white px-2 text-sm outline-none focus:border-rivo-500"
          >
            <option value="local_provider">Bank / mobile wallet</option>
            <option value="card">Card</option>
          </select>
        </div>
        <Button
          className="mt-2.5 w-full"
          size="sm"
          disabled={requesting || data.walletBalanceRs <= 0}
          onClick={handleRequestPayout}
        >
          Request payout
        </Button>
        <p className="mt-2 text-[10px] text-ink-700/50">
          Requesting moves the amount from your available balance into pending until an admin confirms the transfer completed.
        </p>
      </Card>

      {payouts.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-ink-700/50">Payout history</p>
          <div className="space-y-2">
            {payouts.map((p) => (
              <Card key={p.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-bold">{formatMoney(p.amount, data.currencyCode, locale)}</p>
                  <p className="text-[10px] text-ink-700/50">
                    {PAYOUT_STATUS_LABEL[p.status]} · {new Date(p.createdAt).toLocaleDateString(locale)}
                  </p>
                </div>
                {p.status === "requested" && (
                  <Button variant="ghost" size="sm" onClick={() => handleCancelPayout(p.id)}>
                    Cancel
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-ink-900/[0.03] p-3 text-xs text-ink-700/60">
        <Wallet className="h-4 w-4 shrink-0" />
        Payouts are recorded per completed ride as soon as it ends. A withdrawal request is confirmed once an admin verifies the transfer with the payment provider.
      </div>
    </div>
  )
}
