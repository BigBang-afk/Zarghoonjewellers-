import { useEffect, useState } from "react"
import { ArrowLeft, Wallet as WalletIcon } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { LoadingState } from "../../components/ui/States"
import { passengerApi } from "../../api/passenger"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { WalletTransaction } from "../../types"

const TOPUP_AMOUNTS = [200, 500, 1000, 2000]

export function WalletPanel({ onClose }: { onClose: () => void }) {
  const { push } = useToast()
  const { locale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(0)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [toppingUp, setToppingUp] = useState<number | null>(null)

  async function load() {
    try {
      const wallet = await passengerApi.wallet()
      setBalance(wallet.balance)
      setCurrencyCode(wallet.currencyCode)
      setTransactions(wallet.transactions)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function topup(amount: number) {
    setToppingUp(amount)
    try {
      const result = await passengerApi.walletTopup(amount)
      setBalance(result.balance)
      push("success", `${formatMoney(amount, currencyCode, locale)} added to your wallet.`)
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setToppingUp(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-24 pt-4 scrollbar-none">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/[0.05]">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <p className="font-display text-lg font-bold">Wallet</p>
      </div>

      {loading ? (
        <LoadingState label="Loading your wallet…" />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-2xl bg-rivo-600 p-5 text-white shadow-rivo-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
              <WalletIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-white/70">Balance</p>
              <p className="font-display text-2xl font-extrabold">{formatMoney(balance, currencyCode, locale)}</p>
            </div>
          </div>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Top up</p>
          <div className="grid grid-cols-4 gap-2">
            {TOPUP_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                variant="secondary"
                size="sm"
                disabled={toppingUp !== null}
                onClick={() => topup(amount)}
              >
                {toppingUp === amount ? "…" : formatMoney(amount, currencyCode, locale)}
              </Button>
            ))}
          </div>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-700/50">Recent activity</p>
          {transactions.length === 0 ? (
            <p className="text-sm text-ink-700/50">No transactions yet.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((t) => (
                <Card key={t.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold capitalize">{t.type.replace(/_/g, " ")}</p>
                    <p className="text-[11px] text-ink-700/50">{t.description ?? new Date(t.createdAt).toLocaleString(locale)}</p>
                  </div>
                  <p className={`font-display text-sm font-extrabold ${t.amount >= 0 ? "text-success-600" : "text-danger-600"}`}>
                    {t.amount >= 0 ? "+" : ""}
                    {formatMoney(t.amount, currencyCode, locale)}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
