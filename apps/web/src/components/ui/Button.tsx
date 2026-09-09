import type { ButtonHTMLAttributes, ReactNode } from "react"

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold"
type Size = "sm" | "md" | "lg"

const variants: Record<Variant, string> = {
  primary: "bg-rivo-600 text-white hover:bg-rivo-700 active:bg-rivo-800 shadow-rivo-sm",
  secondary: "bg-white text-ink-900 border border-ink-900/10 hover:bg-ink-900/[0.03]",
  ghost: "bg-transparent text-ink-900 hover:bg-ink-900/[0.05]",
  danger: "bg-danger-500 text-white hover:bg-danger-600",
  gold: "bg-gold-400 text-ink-900 hover:bg-gold-500 shadow-rivo-sm",
}

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-lg gap-1.5",
  md: "h-11 px-5 text-sm rounded-xl gap-2",
  lg: "h-14 px-6 text-base rounded-2xl gap-2.5",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  fullWidth?: boolean
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
