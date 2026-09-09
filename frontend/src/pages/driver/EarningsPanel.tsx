import { useEffect, useState } from "react"
import { Clock, Route, Star, Wallet } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { LoadingState } from "../../components/ui/States"
import { driverApi } from "../../api/driver"
import { useToast, errorMessage } from "../../shared/Toast"
import type { DriverEarningsSummary } from "../../types"

export function EarningsPanel() {
  const [data, setData] = useState<DriverEarningsSummary | null>(null)
  const { push } = useToast()

  useEffect(() => {
    driverApi.earnings().then(setData).catch((err) => push("error", errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!data) return <LoadingState label="Loading earnings…" />

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <p className="font-display text-lg font-bold">Earnings</p>

      <Card className="mt-3 p-5">
        <p className="text-xs text-ink-700/60">Wallet balance</p>
        <p className="font-display text-3xl font-extrabold text-rivo-600">Rs {data.walletBalanceRs.toLocaleString()}</p>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          { label: "Today", v: data.today },
          { label: "This week", v: data.week },
          { label: "This month", v: data.month },
        ].map((p) => (
          <Card key={p.label} className="p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-700/50">{p.label}</p>
            <p className="mt-1 font-display text-base font-extrabold">Rs {p.v.totalRs.toLocaleString()}</p>
            <p className="text-[10px] text-ink-700/50">{p.v.rides} rides</p>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
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
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-ink-900/[0.03] p-3 text-xs text-ink-700/60">
        <Wallet className="h-4 w-4 shrink-0" />
        Payouts are recorded per completed ride as soon as it ends — withdrawal to a bank/mobile-wallet method is a Phase 3 feature (see the completion report).
      </div>
    </div>
  )
}
