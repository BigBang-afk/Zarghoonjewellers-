import { useState } from "react"
import { Star } from "lucide-react"
import { Card } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { ridesApi } from "../../api/rides"
import { useToast, errorMessage } from "../../shared/Toast"

export function DriverRatingPanel({ rideId, passengerName, onDone }: { rideId: string; passengerName: string; onDone: () => void }) {
  const [score, setScore] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const { push } = useToast()

  async function submit() {
    setSubmitting(true)
    try {
      await ridesApi.submitRating(rideId, score)
      push("success", "Rating submitted.")
      onDone()
    } catch (err) {
      push("error", errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <Card className="w-full p-6 text-center">
        <p className="font-display text-lg font-bold">Ride completed</p>
        <p className="mt-1 text-sm text-ink-700/60">Rate {passengerName}</p>
        <div className="mt-5 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setScore(n)}>
              <Star className={`h-8 w-8 ${n <= score ? "fill-gold-400 text-gold-400" : "text-ink-900/15"}`} />
            </button>
          ))}
        </div>
        <Button fullWidth size="lg" className="mt-5" onClick={submit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit rating"}
        </Button>
        <button onClick={onDone} className="mt-3 text-xs font-semibold text-ink-700/50">Skip for now</button>
      </Card>
    </div>
  )
}
