import { api } from "./client"
import type { ReferralSummary } from "../types"

export const accountApi = {
  setLocale: (locale: string) => api.patch<{ locale: string }>("/account/locale", { locale }),
  referral: () => api.get<ReferralSummary>("/account/referral"),
  applyReferralCode: (code: string) => api.post<{ ok: boolean }>("/account/referral/apply", { code }),
  featureFlags: () => api.get<{ flags: Record<string, boolean> }>("/account/feature-flags"),
  experiments: () => api.get<{ assignments: Record<string, string> }>("/account/experiments"),
}
