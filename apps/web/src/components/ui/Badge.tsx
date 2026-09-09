import type { ReactNode } from "react"

type Tone = "neutral" | "success" | "danger" | "warning" | "brand"

const tones: Record<Tone, string> = {
  neutral: "bg-ink-900/[0.06] text-ink-700",
  success: "bg-success-500/10 text-success-600",
  danger: "bg-danger-500/10 text-danger-600",
  warning: "bg-gold-400/15 text-gold-700",
  brand: "bg-rivo-600/10 text-rivo-700",
}

export function Badge({
  children,
  tone = "neutral",
  dot,
  className = "",
}: {
  children: ReactNode
  tone?: Tone
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
