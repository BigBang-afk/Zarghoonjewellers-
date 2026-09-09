import { Navigate, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { useAuth } from "./AuthContext"
import type { UserRole } from "../types"

export function ProtectedRoute({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-41px)] items-center justify-center bg-[#F6F5FB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-rivo-600 border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
