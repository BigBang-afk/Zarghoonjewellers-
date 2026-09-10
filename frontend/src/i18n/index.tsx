import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { en, type Dictionary, type TranslationKey } from "./en"
import { ur } from "./ur"

/**
 * Localization architecture (Phase 4 §2). "en" and "ur" ship with real
 * translations; adding Arabic/Pashto/Persian/etc. later is just a new
 * dictionary file (matching the Dictionary type) plus one line in
 * DICTIONARIES and RTL_LOCALES below — no other code changes.
 */
export const DICTIONARIES: Record<string, Dictionary> = { en, ur }
export const SUPPORTED_LOCALES = Object.keys(DICTIONARIES)
const RTL_LOCALES = new Set(["ur", "ar", "ps", "fa"])

const STORAGE_KEY = "rivo.locale"

interface LocaleContextValue {
  locale: string
  setLocale: (locale: string) => void
  dir: "ltr" | "rtl"
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "en"
    } catch {
      return "en"
    }
  })

  const dir: "ltr" | "rtl" = RTL_LOCALES.has(locale) ? "rtl" : "ltr"

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  function setLocale(next: string) {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // private-browsing/storage-blocked — locale still works for this session
    }
  }

  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES.en
  const t = useMemo(
    () => (key: TranslationKey, vars?: Record<string, string | number>) => interpolate(dictionary[key] ?? String(key), vars),
    [dictionary],
  )

  return <LocaleContext.Provider value={{ locale, setLocale, dir, t }}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider")
  return ctx
}

/** Convenience alias — most call sites only need the translate function. */
export function useT() {
  return useLocale().t
}
