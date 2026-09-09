import type { HTMLAttributes } from "react"

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl bg-white border border-ink-900/[0.06] shadow-rivo-sm ${className}`}
      {...props}
    />
  )
}
