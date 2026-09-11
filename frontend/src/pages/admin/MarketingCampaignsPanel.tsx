import { useEffect, useState } from "react"
import { Megaphone, Send, X } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Badge } from "../../components/ui/Badge"
import { Button } from "../../components/ui/Button"
import { LoadingState, EmptyState } from "../../components/ui/States"
import { adminApi } from "../../api/admin"
import { useToast, errorMessage } from "../../shared/Toast"
import type { City, MarketingCampaign } from "../../types"

const STATUS_TONE: Record<MarketingCampaign["status"], "neutral" | "brand" | "success" | "danger"> = {
  draft: "neutral",
  scheduled: "brand",
  sent: "success",
  cancelled: "danger",
}

function NewCampaignForm({ cities, onCreated }: { cities: City[]; onCreated: () => void }) {
  const { push } = useToast()
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [targetRole, setTargetRole] = useState<"passenger" | "driver">("passenger")
  const [cityId, setCityId] = useState("")
  const [maxCompletedRides, setMaxCompletedRides] = useState("")
  const [minDaysSinceLastRide, setMinDaysSinceLastRide] = useState("")
  const [promoCode, setPromoCode] = useState("")
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function segment() {
    return {
      targetRole,
      cityId: cityId || undefined,
      maxCompletedRides: maxCompletedRides ? Number(maxCompletedRides) : undefined,
      minDaysSinceLastRide: minDaysSinceLastRide ? Number(minDaysSinceLastRide) : undefined,
    }
  }

  async function preview() {
    setPreviewing(true)
    try {
      const r = await adminApi.previewCampaignAudience(segment())
      setPreviewCount(r.recipientCount)
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function create() {
    if (!name.trim() || !title.trim() || !body.trim()) {
      push("error", "Fill in name, title, and message.")
      return
    }
    setSubmitting(true)
    try {
      await adminApi.createCampaign({ name: name.trim(), title: title.trim(), body: body.trim(), promoCode: promoCode.trim() || undefined, ...segment() })
      push("success", "Campaign created as a draft.")
      setName(""); setTitle(""); setBody(""); setPromoCode(""); setPreviewCount(null)
      onCreated()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-bold">New campaign</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Internal name" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as "passenger" | "driver")} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="passenger">Passengers</option>
          <option value="driver">Drivers</option>
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notification title" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500 sm:col-span-2" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body" className="h-20 resize-none rounded-lg border border-ink-900/10 p-3 text-sm outline-none focus:border-rivo-500 sm:col-span-2" />
        <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="Promo code (optional)" className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500" />
        <input
          value={maxCompletedRides}
          onChange={(e) => setMaxCompletedRides(e.target.value)}
          placeholder="Max completed rides (e.g. 0 = never ridden)"
          type="number"
          className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
        />
        <input
          value={minDaysSinceLastRide}
          onChange={(e) => setMinDaysSinceLastRide(e.target.value)}
          placeholder="Min days since last ride (inactivity)"
          type="number"
          className="h-10 rounded-lg border border-ink-900/10 px-3 text-sm outline-none focus:border-rivo-500"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={preview} disabled={previewing}>
          {previewing ? "Checking…" : "Preview audience"}
        </Button>
        {previewCount != null && <span className="text-xs font-semibold text-ink-700/70">{previewCount} recipients would be reached</span>}
      </div>
      <Button className="mt-3" size="sm" onClick={create} disabled={submitting}>
        {submitting ? "Creating…" : "Save as draft"}
      </Button>
    </Card>
  )
}

export function MarketingCampaignsPanel() {
  const { push } = useToast()
  const [cities, setCities] = useState<City[]>([])
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    adminApi.campaigns().then((r) => setCampaigns(r.campaigns)).catch((err) => push("error", errorMessage(err))).finally(() => setLoading(false))
  }

  useEffect(() => {
    adminApi.cities().then((r) => setCities(r.cities))
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function send(id: string) {
    if (!confirm("Send this campaign now? This can't be undone.")) return
    setBusyId(id)
    try {
      await adminApi.sendCampaign(id)
      push("success", "Campaign sent.")
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(id: string) {
    setBusyId(id)
    try {
      await adminApi.cancelCampaign(id)
      load()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Marketing campaigns</h1>
        <p className="text-sm text-ink-700/60">Targeted broadcasts to a passenger or driver segment — delivered as push notifications</p>
      </div>

      <div className="mb-5">
        <NewCampaignForm cities={cities} onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" description="Create one above to reach a targeted segment of users." />
      ) : (
        <div className="space-y-2.5">
          {campaigns.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{c.name}</p>
                  <p className="text-xs text-ink-700/50">
                    {c.title} · {c.targetRole} · {c.city?.name ?? "all cities"}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </div>
              <p className="mt-2 text-xs text-ink-700/60">{c.body}</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-ink-700/50">
                  {c.status === "sent" ? `Sent to ${c.recipientCount} recipients` : "Not sent yet"}
                </p>
                {(c.status === "draft" || c.status === "scheduled") && (
                  <div className="flex gap-2">
                    <button onClick={() => cancel(c.id)} disabled={busyId === c.id} className="flex items-center gap-1 text-[11px] font-bold text-danger-600">
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button onClick={() => send(c.id)} disabled={busyId === c.id} className="flex items-center gap-1 text-[11px] font-bold text-rivo-600">
                      <Send className="h-3 w-3" /> Send now
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
