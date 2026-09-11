import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Handshake, Key, Plus } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import type { Partner, PartnerDetail } from "../../types"

function PartnerDetailView({ partner }: { partner: Partner }) {
  const { push } = useToast()
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [payoutAmount, setPayoutAmount] = useState("")
  const [payoutMethod, setPayoutMethod] = useState("bank_transfer")
  const [busy, setBusy] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)

  function load() {
    setLoading(true)
    adminApi.partnerDetail(partner.id).then(setDetail).catch((err) => push("error", errorMessage(err))).finally(() => setLoading(false))
  }

  useEffect(load, [partner.id])

  async function recordPayout() {
    const amount = Number(payoutAmount)
    if (!amount || amount <= 0) {
      push("error", "Enter a valid amount.")
      return
    }
    setBusy(true)
    try {
      await adminApi.recordPartnerPayout(partner.id, { amount, method: payoutMethod })
      push("success", "Payout recorded.")
      setPayoutAmount("")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function generateKey() {
    setBusy(true)
    try {
      const r = await adminApi.generatePartnerApiKey(partner.id)
      setNewApiKey(r.apiKey)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function revokeKey() {
    if (!confirm("Revoke this partner's API key? Any integration using it will stop working immediately.")) return
    setBusy(true)
    try {
      await adminApi.revokePartnerApiKey(partner.id)
      setNewApiKey(null)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading || !detail) return <LoadingState label="Loading partner…" />

  const owed = detail.totalEarned - detail.totalPaidOut

  return (
    <div className="border-t border-ink-900/[0.06] p-4 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Key className="h-4 w-4 text-rivo-600" />
        <p className="text-sm font-bold">Partner API</p>
      </div>
      {newApiKey ? (
        <div className="mb-3 rounded-lg border border-warning-500/30 bg-gold-400/10 p-3">
          <p className="text-xs font-bold text-ink-900">Copy this key now — it won't be shown again:</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs">{newApiKey}</code>
        </div>
      ) : detail.apiEnabled ? (
        <p className="mb-3 text-xs text-ink-700/60">Active key: {detail.apiKeyPrefix}… (generated {detail.apiKeyCreatedAt ? new Date(detail.apiKeyCreatedAt).toLocaleDateString() : ""})</p>
      ) : (
        <p className="mb-3 text-xs text-ink-700/60">No API key generated — this partner can't call the partner API yet.</p>
      )}
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant="secondary" onClick={generateKey} disabled={busy}>
          {detail.apiEnabled ? "Regenerate key" : "Generate key"}
        </Button>
        {detail.apiEnabled && (
          <button onClick={revokeKey} disabled={busy} className="text-xs font-bold text-danger-600">Revoke</button>
        )}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-ink-900/[0.03] p-3 text-center">
          <p className="font-display text-lg font-extrabold">{formatMoney(detail.totalEarned, null)}</p>
          <p className="text-[11px] text-ink-700/50">Total earned</p>
        </div>
        <div className="rounded-lg bg-ink-900/[0.03] p-3 text-center">
          <p className="font-display text-lg font-extrabold">{formatMoney(detail.totalPaidOut, null)}</p>
          <p className="text-[11px] text-ink-700/50">Paid out</p>
        </div>
        <div className="rounded-lg bg-rivo-600/10 p-3 text-center">
          <p className="font-display text-lg font-extrabold text-rivo-600">{formatMoney(owed, null)}</p>
          <p className="text-[11px] text-ink-700/50">Owed</p>
        </div>
      </div>

      <p className="mb-2 text-sm font-bold">Referrals ({detail.referrals.length})</p>
      {detail.referrals.length === 0 ? (
        <p className="mb-3 text-sm text-ink-700/50">No referrals yet.</p>
      ) : (
        <div className="mb-3 space-y-1.5">
          {detail.referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-sm">
              <span className="font-semibold">{r.referredUser?.fullName ?? "—"}</span>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === "qualified" ? "success" : "neutral"}>{r.status}</Badge>
                {r.status === "qualified" && <span className="text-xs text-ink-700/50">{formatMoney(r.commissionEarned, null)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {owed > 0 && (
        <>
          <p className="mb-2 text-sm font-bold">Record payout</p>
          <div className="flex gap-2">
            <input value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} type="number" max={owed} placeholder={`Up to ${owed}`} className="h-9 flex-1 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500" />
            <select value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)} className="h-9 rounded-lg border border-ink-900/10 px-2.5 text-sm outline-none focus:border-rivo-500">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="mobile_wallet">Mobile wallet</option>
            </select>
            <Button size="sm" onClick={recordPayout} disabled={busy}>Record</Button>
          </div>
        </>
      )}

      {detail.payouts.length > 0 && (
        <>
          <p className="mb-2 mt-3 text-sm font-bold">Payout history</p>
          <div className="space-y-1.5">
            {detail.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-ink-900/[0.03] px-3 py-2 text-sm">
                <span className="font-semibold">{formatMoney(p.amount, null)}</span>
                <span className="text-xs text-ink-700/50">{p.method} · {new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function NewPartnerForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useToast()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [type, setType] = useState<"individual" | "business">("individual")
  const [commissionType, setCommissionType] = useState<"flat_per_referral" | "pct_of_fare">("flat_per_referral")
  const [commissionValue, setCommissionValue] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function create() {
    if (!name.trim() || !code.trim() || !commissionValue) {
      push("error", "Fill in name, code, and commission value.")
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createPartner({ name: name.trim(), code: code.trim(), type, commissionType, commissionValue: Number(commissionValue) })
      push("success", "Partner created.")
      setName(""); setCode(""); setCommissionValue("")
      onCreated()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold">New partner</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Partner name" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Referral code" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <select value={type} onChange={(e) => setType(e.target.value as "individual" | "business")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </select>
        <select value={commissionType} onChange={(e) => setCommissionType(e.target.value as "flat_per_referral" | "pct_of_fare")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="flat_per_referral">Flat amount per referral</option>
          <option value="pct_of_fare">Percentage of first ride fare</option>
        </select>
        <input
          value={commissionValue}
          onChange={(e) => setCommissionValue(e.target.value)}
          type="number"
          placeholder={commissionType === "pct_of_fare" ? "Percentage (e.g. 10)" : "Amount per referral"}
          className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500 sm:col-span-2"
        />
      </div>
      <Button className="mt-3" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={create} disabled={submitting}>
        {submitting ? "Creating…" : "Create partner"}
      </Button>
    </Card>
  )
}

export function PartnersPanel() {
  const { push } = useToast()
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function load() {
    adminApi.partners().then((r) => setPartners(r.partners)).catch((err) => push("error", errorMessage(err))).finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Partner program</h1>
        <p className="text-sm text-ink-700/60">External referrers with a tracked code and commission on qualifying referrals</p>
      </div>

      <div className="mb-5">
        <NewPartnerForm onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading partners…" />
      ) : partners.length === 0 ? (
        <EmptyState icon={Handshake} title="No partners yet" description="Create one above to start tracking external referrals." />
      ) : (
        <div className="space-y-3">
          {partners.map((p) => (
            <Card key={p.id} className="overflow-hidden p-0">
              <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} className="flex w-full items-center justify-between p-4 text-left">
                <div className="flex items-center gap-3">
                  {expandedId === p.id ? <ChevronDown className="h-4 w-4 text-ink-700/50" /> : <ChevronRight className="h-4 w-4 text-ink-700/50" />}
                  <div>
                    <p className="text-sm font-bold">{p.name}</p>
                    <p className="text-xs text-ink-700/50">
                      Code {p.code} · {p._count?.referrals ?? 0} referrals ·{" "}
                      {p.commissionType === "flat_per_referral" ? formatMoney(p.commissionValue, null) : `${p.commissionValue}%`} commission
                    </p>
                  </div>
                </div>
                <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Badge>
              </button>
              {expandedId === p.id && <PartnerDetailView partner={p} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
