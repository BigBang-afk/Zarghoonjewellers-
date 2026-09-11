import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { accountApi } from "../api/account"
import { useAuth } from "../auth/AuthContext"

interface ExperimentsContextValue {
  variantFor: (key: string) => string | null
  loading: boolean
}

const ExperimentsContext = createContext<ExperimentsContextValue>({ variantFor: () => null, loading: false })

/**
 * Phase 5 §22 — fetches every running experiment's sticky assignment for
 * the signed-in user once per session (see account/router.ts's GET
 * /account/experiments) and makes them available via
 * useExperimentVariant(key). An unassigned or unknown experiment reads as
 * null, never throws.
 */
export function ExperimentsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user || user.role === "admin") {
      setAssignments({})
      return
    }
    setLoading(true)
    accountApi
      .experiments()
      .then((r) => setAssignments(r.assignments))
      .catch(() => setAssignments({}))
      .finally(() => setLoading(false))
  }, [user])

  return (
    <ExperimentsContext.Provider value={{ variantFor: (key) => assignments[key] ?? null, loading }}>{children}</ExperimentsContext.Provider>
  )
}

export function useExperimentVariant(key: string): string | null {
  return useContext(ExperimentsContext).variantFor(key)
}
