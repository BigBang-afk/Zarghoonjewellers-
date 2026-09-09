import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { authApi } from "../api/auth"
import { tokenStore } from "./tokenStore"
import type { PublicUser } from "../types"
import { connectSocket, disconnectSocket } from "../services/socket"

interface AuthContextValue {
  user: PublicUser | null
  loading: boolean
  login: (phone: string, password: string) => Promise<PublicUser>
  logout: () => Promise<void>
  setUserAfterVerification: (user: PublicUser, accessToken: string, refreshToken: string) => void
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(() => tokenStore.getStoredUser<PublicUser>())
  const [loading, setLoading] = useState(true)

  const bootstrap = useCallback(async () => {
    const token = tokenStore.getAccessToken()
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const { user: freshUser } = await authApi.me()
      setUser(freshUser)
      tokenStore.setStoredUser(freshUser)
      connectSocket()
    } catch {
      tokenStore.clear()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const login = useCallback(async (phone: string, password: string) => {
    const result = await authApi.login(phone, password)
    tokenStore.setTokens(result.accessToken, result.refreshToken)
    tokenStore.setStoredUser(result.user)
    setUser(result.user)
    connectSocket()
    return result.user
  }, [])

  const setUserAfterVerification = useCallback((verifiedUser: PublicUser, accessToken: string, refreshToken: string) => {
    tokenStore.setTokens(accessToken, refreshToken)
    tokenStore.setStoredUser(verifiedUser)
    setUser(verifiedUser)
    connectSocket()
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken()
    tokenStore.clear()
    setUser(null)
    disconnectSocket()
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken)
      } catch {
        // best-effort — client-side state is already cleared
      }
    }
  }, [])

  const refreshMe = useCallback(async () => {
    const { user: freshUser } = await authApi.me()
    setUser(freshUser)
    tokenStore.setStoredUser(freshUser)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, setUserAfterVerification, refreshMe }),
    [user, loading, login, logout, setUserAfterVerification, refreshMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
