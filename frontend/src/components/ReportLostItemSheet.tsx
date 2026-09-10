import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "./ui/Button"
import { ridesApi } from "../api/rides"
import { useToast, errorMessage } from "../shared/Toast"
import type { LostItemCategory } from "../types"

const CATEGORIES: { code: LostItemCategory; label: string }[] = [
  { code: "electronics", label: "Electronics" },
  { code: "documents", label: "Documents" },
  { code: "bag_or_wallet", label: "Bag or wallet" },
  { code: "clothing", label: "Clothing" },
  { code: "accessories", label: "Accessories" },
  { code: "other", label: "Other" },
]

/** Phase 5 §15 — passenger-side lost-item report form, reachable right after a ride completes. */
export function ReportLostItemSheet({ rideId, onClose, onReported }: { rideId: string; onClose: () => void; onReported: () => void }) {
  const { push } = useToast()
  const [category, setCategory] = useState<LostItemCategory>("electronics")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (description.trim().length < 3) {
      push("error", "Describe the item in a few more words.")
      return
    }
    setSubmitting(true)
    try {
      await ridesApi.reportLostItem(rideId, category, description.trim())
      push("success", "Report sent to your driver.")
      onReported()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-rivo-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-lg font-bold">Report a lost item</p>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-900/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-700/60">We'll notify your driver right away.</p>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCategory(c.code)}
              className={`rounded-xl border p-2.5 text-xs font-semibold transition-colors ${
                category === c.code ? "border-rivo-600 bg-rivo-600/[0.06] text-rivo-600" : "border-ink-900/10 text-ink-700/70"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the item (color, brand, where it was in the car)…"
          className="h-24 w-full resize-none rounded-xl border border-ink-900/10 p-3 text-sm outline-none focus:border-rivo-500"
        />
        <Button fullWidth size="lg" className="mt-4" onClick={submit} disabled={submitting}>
          {submitting ? "Sending…" : "Send report"}
        </Button>
      </div>
    </div>
  )
}
