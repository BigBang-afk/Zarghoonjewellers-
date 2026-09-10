import { X } from "lucide-react"
import { Button } from "./ui/Button"

const PASSENGER_REASONS: { code: string; label: string }[] = [
  { code: "changed_mind", label: "I changed my mind" },
  { code: "found_alternative", label: "Found another ride" },
  { code: "driver_too_far", label: "Driver is too far away" },
  { code: "driver_not_moving", label: "Driver isn't moving" },
  { code: "wrong_pickup_location", label: "Wrong pickup location" },
  { code: "price_too_high", label: "Price is too high" },
  { code: "long_wait", label: "Waiting too long" },
  { code: "other", label: "Other" },
]

const DRIVER_REASONS: { code: string; label: string }[] = [
  { code: "passenger_no_show", label: "Passenger didn't show up" },
  { code: "passenger_unreachable", label: "Can't reach the passenger" },
  { code: "unsafe_pickup_location", label: "Unsafe pickup location" },
  { code: "vehicle_issue", label: "Vehicle issue" },
  { code: "wrong_trip_details", label: "Wrong trip details" },
  { code: "traffic_or_emergency", label: "Traffic or emergency" },
  { code: "other", label: "Other" },
]

/**
 * Phase 5 §14 — structured cancellation reason picker, shared by every
 * passenger/driver cancel flow so the backend always gets a reason code
 * (never just free text as the primary signal — see cancellationService.ts).
 */
export function CancellationReasonSheet({
  role,
  onSelect,
  onClose,
}: {
  role: "passenger" | "driver"
  onSelect: (reasonCode: string) => void
  onClose: () => void
}) {
  const reasons = role === "passenger" ? PASSENGER_REASONS : DRIVER_REASONS

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-rivo-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-lg font-bold">Why are you cancelling?</p>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink-900/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-2">
          {reasons.map((r) => (
            <Button key={r.code} variant="secondary" fullWidth className="justify-start" onClick={() => onSelect(r.code)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
