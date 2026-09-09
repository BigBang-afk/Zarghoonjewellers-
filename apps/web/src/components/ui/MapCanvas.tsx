import type { ReactNode } from "react"

/**
 * Stylized mock map surface — an illustrative grid of streets/blocks used to
 * stage pins and driver markers. This is a design placeholder, not a live
 * map tile integration; swap for a real maps SDK (Mapbox/Google) at
 * integration time.
 */
export function MapCanvas({
  tone = "light",
  children,
  className = "",
}: {
  tone?: "light" | "dark"
  children?: ReactNode
  className?: string
}) {
  const isDark = tone === "dark"
  return (
    <div
      className={`relative overflow-hidden ${isDark ? "bg-ink-800" : "bg-[#EDEBFB]"} ${className}`}
    >
      {/* blocks */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: `linear-gradient(${isDark ? "#1a1d28" : "#E2DFF7"} 1px, transparent 1px), linear-gradient(90deg, ${isDark ? "#1a1d28" : "#E2DFF7"} 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
        }}
      />
      {/* major roads */}
      <div className={`absolute left-[18%] top-0 h-full w-[3px] ${isDark ? "bg-ink-600" : "bg-white"}`} />
      <div className={`absolute left-[62%] top-0 h-full w-[5px] ${isDark ? "bg-ink-600" : "bg-white"}`} />
      <div className={`absolute top-[30%] left-0 w-full h-[3px] ${isDark ? "bg-ink-600" : "bg-white"}`} />
      <div className={`absolute top-[72%] left-0 w-full h-[5px] ${isDark ? "bg-ink-600" : "bg-white"}`} />
      {/* diagonal avenue */}
      <div
        className={`absolute left-[-10%] top-[55%] h-[4px] w-[130%] ${isDark ? "bg-ink-600" : "bg-white"}`}
        style={{ transform: "rotate(-9deg)" }}
      />
      {/* green patch = park */}
      <div className={`absolute left-[70%] top-[10%] h-24 w-28 rounded-3xl ${isDark ? "bg-success-500/10" : "bg-success-500/15"}`} />

      {children}
    </div>
  )
}

export function MapPin({
  x,
  y,
  variant = "dot",
  label,
}: {
  x: number
  y: number
  variant?: "dot" | "pickup" | "destination" | "you"
  label?: string
}) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center" style={{ left: `${x}%`, top: `${y}%` }}>
      {label && (
        <span className="mb-1 rounded-md bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-white shadow-rivo-sm whitespace-nowrap">
          {label}
        </span>
      )}
      {variant === "you" ? (
        <span className="relative flex h-4 w-4 items-center justify-center translate-y-full">
          <span className="absolute h-8 w-8 rounded-full bg-rivo-500/20 animate-ping" />
          <span className="h-3.5 w-3.5 rounded-full bg-rivo-600 ring-4 ring-white" />
        </span>
      ) : (
        <svg width="26" height="34" viewBox="0 0 26 34" fill="none">
          <path
            d="M13 34C13 34 24 21.5 24 13A11 11 0 1 0 2 13C2 21.5 13 34 13 34Z"
            fill={variant === "destination" ? "#0B0D12" : "#5B3FE0"}
          />
          <circle cx="13" cy="13" r="4.5" fill="white" />
        </svg>
      )}
    </div>
  )
}

export function CarMarker({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-rivo-md"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div style={{ transform: `rotate(${rotate}deg)` }} className="h-2.5 w-2.5 rounded-[3px] bg-ink-900" />
    </div>
  )
}
