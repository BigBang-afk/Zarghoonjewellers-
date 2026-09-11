import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { accountApi } from "../api/account"
import { useAuth } from "../auth/AuthContext"

interface FeatureFlagsContextValue {
  isEnabled: (key: string) => boolean
  loading: boolean
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({ isEnabled: () => false, loading: false })

/**
 * Phase 5 §21 — fetches every flag evaluated for the signed-in user once
 * per session (see account/router.ts's GET /account/feature-flags) and
 * makes them available via useFeatureFlag(key). An unknown or not-yet-
 * loaded flag reads as false, never throws — a missing flag should never
 * break rendering.
 */
export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user || user.role === "admin") {
      setFlags({})
      return
    }
    setLoading(true)
    accountApi
      .featureFlags()
      .then((r) => setFlags(r.flags))
      .catch(() => setFlags({}))
      .finally(() => setLoading(false))
  }, [user])

  return <FeatureFlagsContext.Provider value={{ isEnabled: (key) => flags[key] ?? false, loading }}>{children}</FeatureFlagsContext.Provider>
}

export function useFeatureFlag(key: string): boolean {
  return useContext(FeatureFlagsContext).isEnabled(key)
}
