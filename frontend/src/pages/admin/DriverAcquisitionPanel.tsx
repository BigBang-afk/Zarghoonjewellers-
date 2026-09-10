import { useEffect, useState } from "react"
import { TrendingUp, Plus, Users, ShieldCheck, CheckCircle2, Wifi, Car, Repeat } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { City, DriverAcquisitionCampaign, DriverFunnelStage } from "../../types"

const STAGE_LABEL: Record<DriverFunnelStage["stage"], string> = {
  applications: "Applications",
  verification_pending: "Verification pending",
  approved: "Approved",
  online: "Online now",
  first_ride: "Completed first ride",
  active: "Active (30d)",
}
const STAGE_ICON: Record<DriverFunnelStage["stage"], typeof Users> = {
  applications: Users,
  verification_pending: ShieldCheck,
  approved: CheckCircle2,
  online: Wifi,
  first_ride: Car,
  active: Repeat,
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "brand"> = {
  active: "success",
  draft: "neutral",
  paused: "warning",
  completed: "brand",
}

function FunnelChart({ stages, currencyLabel }: { stages: DriverFunnelStage[]; currencyLabel?: string }) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  return (
    <div className="space-y-2.5">
      {stages.map((s) => {
        const Icon = STAGE_ICON[s.stage]
        const pct = Math.round((s.count / max) * 100)
        return (
          <div key={s.stage} className="flex items-center gap-3">
            <Icon className="h-4 w-4 shrink-0 text-rivo-600" />
            <div className="w-40 shrink-0 text-xs font-medium text-ink-700/70">{STAGE_LABEL[s.stage]}</div>
            <div className="h-6 flex-1 overflow-hidden rounded-full bg-ink-900/[0.05]">
              <div className="h-full rounded-full bg-rivo-500" style={{ width: `${Math.max(pct, s.count > 0 ? 4 : 0)}%` }} />
            </div>
            <div className="w-10 shrink-0 text-right text-sm font-bold">{s.count}</div>
          </div>
        )
      })}
      {currencyLabel && <p className="pt-1 text-[11px] text-ink-700/50">{currencyLabel}</p>}
    </div>
  )
}

export function DriverAcquisitionPanel() {
  const { push } = useToast()
  const { locale } = useLocale()
  const [campaigns, setCampaigns] = useState<DriverAcquisitionCampaign[] | null>(null)
  const [cities, setCities] = useState<City[]>([])
  const [platformFunnel, setPlatformFunnel] = useState<DriverFunnelStage[] | null>(null)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [campaignFunnel, setCampaignFunnel] = useState<DriverFunnelStage[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    code: "",
    cityId: "",
    targetDriverCount: "50",
    incentiveAmount: "",
    startDate: "",
    endDate: "",
  })

  async function load() {
    try {
      const [c, cityRes, funnel] = await Promise.all([adminApi.driverAcquisitionCampaigns(), adminApi.cities(), adminApi.driverFunnel()])
      setCampaigns(c.campaigns)
      setCities(cityRes.cities)
      setPlatformFunnel(funnel.stages)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedCampaignId) {
      setCampaignFunnel(null)
      return
    }
    adminApi
      .campaignFunnel(selectedCampaignId)
      .then((r) => setCampaignFunnel(r.stages))
      .catch((err) => push("error", errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId])

  async function createCampaign() {
    if (!form.name.trim() || !form.code.trim() || !form.startDate || !form.endDate) {
      push("error", "Name, code, and both dates are required.")
      return
    }
    setSaving(true)
    try {
      await adminApi.createDriverAcquisitionCampaign({
        name: form.name.trim(),
        code: form.code.trim(),
        cityId: form.cityId || undefined,
        targetDriverCount: Number(form.targetDriverCount) || 1,
        incentiveAmount: form.incentiveAmount ? Number(form.incentiveAmount) : undefined,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        status: "active",
      })
      push("success", "Campaign created.")
      setShowForm(false)
      setForm({ name: "", code: "", cityId: "", targetDriverCount: "50", incentiveAmount: "", startDate: "", endDate: "" })
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await adminApi.updateDriverAcquisitionCampaign(id, { status })
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  if (!campaigns || !platformFunnel) return <LoadingState label="Loading driver acquisition data…" />

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Driver acquisition</h1>
          <p className="text-sm text-ink-700/60">Campaigns to attract new drivers, and where they drop off in the funnel</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm((v) => !v)}>
          New campaign
        </Button>
      </div>

      {showForm && (
        <Card className="mb-5 p-4">
          <p className="mb-3 text-sm font-bold">New driver acquisition campaign</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input
              className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm"
              placeholder="Code (e.g. ISB-LAUNCH)"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
            <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: e.target.value }))}>
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              type="number"
              className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm"
              placeholder="Target driver count"
              value={form.targetDriverCount}
              onChange={(e) => setForm((f) => ({ ...f, targetDriverCount: e.target.value }))}
            />
            <input
              type="number"
              className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm"
              placeholder="Signup incentive (optional)"
              value={form.incentiveAmount}
              onChange={(e) => setForm((f) => ({ ...f, incentiveAmount: e.target.value }))}
            />
            <div />
            <input type="date" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            <input type="date" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <p className="mt-2 text-[11px] text-ink-700/50">
            A driver is attributed to this campaign when their registration link passes this code as the acquisitionCampaign field.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={createCampaign} disabled={saving}>{saving ? "Creating…" : "Create campaign"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <p className="mb-3 text-sm font-bold">Campaigns</p>
          {campaigns.length === 0 ? (
            <EmptyState message="No acquisition campaigns yet." />
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => setSelectedCampaignId(null)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${!selectedCampaignId ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10"}`}
              >
                <p className="text-sm font-bold">Platform-wide</p>
                <p className="text-[11px] text-ink-700/55">All drivers, every campaign</p>
              </button>
              {campaigns.map((c) => (
                <div key={c.id} className={`rounded-xl border p-3 transition-colors ${selectedCampaignId === c.id ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10"}`}>
                  <button onClick={() => setSelectedCampaignId(c.id)} className="w-full text-left">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{c.name}</p>
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot>{c.status}</Badge>
                    </div>
                    <p className="text-[11px] text-ink-700/55">
                      {c.code} · {c.city?.name ?? "All cities"} · target {c.targetDriverCount}
                      {c.incentiveAmount != null ? ` · ${formatMoney(c.incentiveAmount, c.city?.currencyCode ?? null, locale)} bonus` : ""}
                    </p>
                  </button>
                  <div className="mt-2 flex gap-1.5">
                    {c.status !== "active" && (
                      <Button variant="secondary" size="sm" onClick={() => setStatus(c.id, "active")}>Activate</Button>
                    )}
                    {c.status === "active" && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(c.id, "paused")}>Pause</Button>
                    )}
                    {c.status !== "completed" && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(c.id, "completed")}>Complete</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-rivo-600" />
            <p className="text-sm font-bold">{selectedCampaign ? `${selectedCampaign.name} funnel` : "Platform-wide driver funnel"}</p>
          </div>
          <FunnelChart stages={(selectedCampaignId ? campaignFunnel : platformFunnel) ?? []} />
        </Card>
      </div>
    </div>
  )
}
