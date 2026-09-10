import { useEffect, useState } from "react"
import { Tag, Plus, BarChart3 } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import { formatMoney } from "../../shared/money"
import { useLocale } from "../../i18n"
import type { City, Promotion, PromotionAnalytics } from "../../types"

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function PromotionsPanel() {
  const { push } = useToast()
  const { locale } = useLocale()
  const [promotions, setPromotions] = useState<Promotion[] | null>(null)
  const [cities, setCities] = useState<City[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<PromotionAnalytics | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [form, setForm] = useState({
    code: "",
    discountType: "percentage" as "percentage" | "flat",
    discountValue: "15",
    maxDiscount: "",
    minFare: "",
    cityId: "",
    newUsersOnly: false,
    existingUsersOnly: false,
    minCompletedRides: "",
    maxCompletedRides: "",
    usageLimit: "",
    expiresAt: "",
    daysOfWeek: [] as number[],
    startHour: "",
    endHour: "",
  })

  async function load() {
    try {
      const [p, c] = await Promise.all([adminApi.promotions(), adminApi.cities()])
      setPromotions(p.promotions)
      setCities(c.cities)
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setAnalytics(null)
      return
    }
    adminApi
      .promotionAnalytics(selectedId)
      .then(setAnalytics)
      .catch((err) => push("error", errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  function toggleDay(d: number) {
    setForm((f) => ({ ...f, daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d] }))
  }

  async function createPromotion() {
    if (!form.code.trim() || !form.discountValue) {
      push("error", "Code and discount value are required.")
      return
    }
    setSaving(true)
    try {
      await adminApi.createPromotion({
        code: form.code.trim().toUpperCase(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : undefined,
        minFare: form.minFare ? Number(form.minFare) : undefined,
        cityId: form.cityId || undefined,
        newUsersOnly: form.newUsersOnly,
        existingUsersOnly: form.existingUsersOnly,
        minCompletedRides: form.minCompletedRides ? Number(form.minCompletedRides) : undefined,
        maxCompletedRides: form.maxCompletedRides ? Number(form.maxCompletedRides) : undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        daysOfWeek: form.daysOfWeek.length ? form.daysOfWeek : undefined,
        startHour: form.startHour ? Number(form.startHour) : undefined,
        endHour: form.endHour ? Number(form.endHour) : undefined,
      })
      push("success", "Promotion created.")
      setShowForm(false)
      setForm({
        code: "", discountType: "percentage", discountValue: "15", maxDiscount: "", minFare: "", cityId: "",
        newUsersOnly: false, existingUsersOnly: false, minCompletedRides: "", maxCompletedRides: "",
        usageLimit: "", expiresAt: "", daysOfWeek: [], startHour: "", endHour: "",
      })
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(promo: Promotion) {
    try {
      await adminApi.updatePromotion(promo.id, { isActive: !promo.isActive })
      await load()
    } catch (err) {
      push("error", errorMessage(err))
    }
  }

  if (!promotions) return <LoadingState label="Loading promotions…" />

  const selected = promotions.find((p) => p.id === selectedId)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Promotions</h1>
          <p className="text-sm text-ink-700/60">Rule-based promo codes and per-campaign redemption analytics</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm((v) => !v)}>
          New promotion
        </Button>
      </div>

      {showForm && (
        <Card className="mb-5 p-4">
          <p className="mb-3 text-sm font-bold">New promotion</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "percentage" | "flat" }))}>
              <option value="percentage">Percentage off</option>
              <option value="flat">Flat amount off</option>
            </select>
            <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Discount value" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} />
            <select className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: e.target.value }))}>
              <option value="">All cities</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Usage limit (optional)" value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))} />
            <input type="date" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.newUsersOnly} onChange={(e) => setForm((f) => ({ ...f, newUsersOnly: e.target.checked, existingUsersOnly: e.target.checked ? false : f.existingUsersOnly }))} />
              First ride only
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.existingUsersOnly} onChange={(e) => setForm((f) => ({ ...f, existingUsersOnly: e.target.checked, newUsersOnly: e.target.checked ? false : f.newUsersOnly }))} />
              Existing users only
            </label>
            <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs font-bold text-rivo-600 underline">
              {advanced ? "Hide" : "Show"} advanced rules
            </button>
          </div>

          {advanced && (
            <div className="mt-3 space-y-3 rounded-xl border border-ink-900/10 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Max discount" value={form.maxDiscount} onChange={(e) => setForm((f) => ({ ...f, maxDiscount: e.target.value }))} />
                <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Min fare" value={form.minFare} onChange={(e) => setForm((f) => ({ ...f, minFare: e.target.value }))} />
                <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Min completed rides" value={form.minCompletedRides} onChange={(e) => setForm((f) => ({ ...f, minCompletedRides: e.target.value }))} />
                <input type="number" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Max completed rides" value={form.maxCompletedRides} onChange={(e) => setForm((f) => ({ ...f, maxCompletedRides: e.target.value }))} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink-700/70">Valid days (none selected = every day)</p>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`rounded-full px-3 py-1 text-xs font-bold ${form.daysOfWeek.includes(i) ? "bg-rivo-600 text-white" : "bg-ink-900/[0.06] text-ink-700"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="number" min={0} max={23} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="Start hour (0-23)" value={form.startHour} onChange={(e) => setForm((f) => ({ ...f, startHour: e.target.value }))} />
                <input type="number" min={0} max={23} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm" placeholder="End hour (0-23)" value={form.endHour} onChange={(e) => setForm((f) => ({ ...f, endHour: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={createPromotion} disabled={saving}>{saving ? "Creating…" : "Create promotion"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <p className="mb-3 text-sm font-bold">All promotions</p>
          {promotions.length === 0 ? (
            <EmptyState icon={Tag} title="No promotions yet" description="Create one to get started." />
          ) : (
            <div className="space-y-2">
              {promotions.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedId === p.id ? "border-rivo-600 bg-rivo-600/[0.06]" : "border-ink-900/10"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">{p.code}</p>
                    <Badge tone={p.isActive ? "success" : "neutral"} dot>{p.isActive ? "active" : "inactive"}</Badge>
                  </div>
                  <p className="text-[11px] text-ink-700/55">
                    {p.discountType === "percentage" ? `${p.discountValue}% off` : `${p.discountValue} off`} · {p.city?.name ?? "All cities"} · used {p.usageCount}{p.usageLimit ? `/${p.usageLimit}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-rivo-600" />
            <p className="text-sm font-bold">{selected ? `${selected.code} analytics` : "Select a promotion"}</p>
          </div>
          {!selected ? (
            <p className="text-sm text-ink-700/50">Pick a promotion from the list to see its rules and redemption analytics.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {selected.newUsersOnly && <Badge tone="brand">First ride only</Badge>}
                {selected.existingUsersOnly && <Badge tone="brand">Existing users only</Badge>}
                {selected.minCompletedRides != null && <Badge tone="neutral">{selected.minCompletedRides}+ rides</Badge>}
                {selected.maxCompletedRides != null && <Badge tone="neutral">≤{selected.maxCompletedRides} rides</Badge>}
                {selected.daysOfWeek && selected.daysOfWeek.length > 0 && (
                  <Badge tone="neutral">{selected.daysOfWeek.map((d) => WEEKDAY_LABELS[d]).join(", ")}</Badge>
                )}
                {selected.startHour != null && selected.endHour != null && <Badge tone="neutral">{selected.startHour}:00–{selected.endHour}:00</Badge>}
                <Button variant="ghost" size="sm" onClick={() => toggleActive(selected)}>{selected.isActive ? "Deactivate" : "Activate"}</Button>
              </div>

              {!analytics ? (
                <LoadingState label="Loading analytics…" />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-ink-900/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Redemptions</p>
                    <p className="mt-1 text-lg font-extrabold">{analytics.redemptions}</p>
                  </div>
                  <div className="rounded-xl bg-ink-900/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Unique redeemers</p>
                    <p className="mt-1 text-lg font-extrabold">{analytics.redeemersCount}</p>
                  </div>
                  <div className="rounded-xl bg-ink-900/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Cost (discount)</p>
                    <p className="mt-1 text-lg font-extrabold">{formatMoney(analytics.totalDiscountRs.value, undefined, locale)}</p>
                  </div>
                  <div className="rounded-xl bg-ink-900/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Gross fare (promo rides)</p>
                    <p className="mt-1 text-lg font-extrabold">{formatMoney(analytics.totalRevenueRs.value, undefined, locale)}</p>
                    <p className="mt-1 text-[10px] text-ink-700/45">{analytics.totalRevenueRs.note}</p>
                  </div>
                  <div className="col-span-2 rounded-xl bg-ink-900/[0.03] p-3 sm:col-span-4">
                    <p className="text-[10px] uppercase tracking-wide text-ink-700/50">Repeat-ride rate among redeemers</p>
                    <p className="mt-1 text-lg font-extrabold">{analytics.repeatRatePct.value != null ? `${analytics.repeatRatePct.value}%` : "—"}</p>
                    <p className="mt-1 text-[10px] text-ink-700/45">{analytics.repeatRatePct.note}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
