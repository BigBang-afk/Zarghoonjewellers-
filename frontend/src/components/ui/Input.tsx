import type { InputHTMLAttributes, ReactNode } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
}

export function Input({ label, error, icon, className = "", id, ...props }: InputProps) {
  const inputId = id ?? props.name
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="mb-1.5 block text-xs font-semibold text-ink-700">{label}</span>}
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-700/40">{icon}</span>}
        <input
          id={inputId}
          className={`h-11 w-full rounded-xl border bg-white px-3.5 text-sm outline-none transition-colors placeholder:text-ink-700/35 focus:border-rivo-500 focus:ring-2 focus:ring-rivo-500/15 ${
            icon ? "pl-10" : ""
          } ${error ? "border-danger-500" : "border-ink-900/10"} ${className}`}
          {...props}
        />
      </div>
      {error && <span className="mt-1 block text-xs font-medium text-danger-600">{error}</span>}
    </label>
  )
}
