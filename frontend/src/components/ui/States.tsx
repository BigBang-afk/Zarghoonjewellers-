import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import { Button } from "./Button"

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-rivo-600" />
      <p className="text-sm text-ink-700/60">{label}</p>
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-900/[0.05] text-ink-700/50">
        <Icon className="h-6 w-6" />
      </div>
      <p className="font-display text-base font-bold">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-700/60">{description}</p>}
      {action && (
        <Button size="sm" variant="secondary" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  )
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-500/10 text-danger-600">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="font-display text-base font-bold">Couldn't load this</p>
      <p className="max-w-xs text-sm text-ink-700/60">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      )}
    </div>
  )
}
