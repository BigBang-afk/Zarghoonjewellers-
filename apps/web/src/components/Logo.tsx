type LogoProps = {
  variant?: "full" | "mark"
  tone?: "light" | "dark"
  className?: string
}

/**
 * RIVO mark: a rounded badge fusing a location pin with a forward "speed"
 * chevron and a price-tag notch — pin (place), chevron (motion), notch (price).
 */
export function Logo({ variant = "full", tone = "dark", className = "" }: LogoProps) {
  const wordColor = tone === "dark" ? "text-ink-900" : "text-white"

  const mark = (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rivoMarkGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8B72F7" />
          <stop offset="1" stopColor="#5B3FE0" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#rivoMarkGrad)" />
      <path
        d="M10 26V10.5h7.4c3.2 0 5.4 2.1 5.4 5 0 2.1-1.2 3.7-3 4.5L24 26h-4.3l-3.7-4.6H13.3V26H10Zm3.3-7.3h3.7c1.5 0 2.5-.9 2.5-2.2 0-1.3-1-2.1-2.5-2.1h-3.7v4.3Z"
        fill="white"
      />
      <circle cx="27" cy="10" r="3" fill="#FFB02E" />
    </svg>
  )

  if (variant === "mark") return <span className={className}>{mark}</span>

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {mark}
      <span className={`font-display text-xl font-extrabold tracking-tight ${wordColor}`}>
        RIVO
      </span>
    </span>
  )
}
