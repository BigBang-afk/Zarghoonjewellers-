// Plain localStorage token storage. Documented tradeoff (see Phase 2
// completion report): vulnerable to XSS reading localStorage — a
// production hardening pass would move refresh tokens to an httpOnly
// cookie issued by the backend instead.

const ACCESS_KEY = "rivo.accessToken"
const REFRESH_KEY = "rivo.refreshToken"
const USER_KEY = "rivo.user"

export const tokenStore = {
  getAccessToken: () => localStorage.getItem(ACCESS_KEY),
  getRefreshToken: () => localStorage.getItem(REFRESH_KEY),
  setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem(ACCESS_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  },
  setAccessToken(accessToken: string) {
    localStorage.setItem(ACCESS_KEY, accessToken)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
  },
  getStoredUser<T>(): T | null {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  },
  setStoredUser<T>(user: T) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
}
