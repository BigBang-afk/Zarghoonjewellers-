import { api } from "./client"
import type { PublicUser } from "../types"

export interface LoginResult {
  user: PublicUser
  accessToken: string
  refreshToken: string
}

export const authApi = {
  login: (phone: string, password: string) => api.post<LoginResult>("/auth/login", { phone, password }, { auth: false }),

  registerPassenger: (input: { fullName: string; phone: string; email?: string; password: string; photoUrl?: string; referredByCode?: string }) =>
    api.post<{ userId: string; otp: { requestId: string; expiresAt: string; devCode?: string } }>("/auth/register/passenger", input, { auth: false }),

  registerDriver: (input: {
    fullName: string
    phone: string
    email: string
    password: string
    cityId: string
    vehicle: { vehicleTypeCode: string; make: string; model: string; year?: number; color?: string; plateNumber: string }
    referredByCode?: string
  }) =>
    api.post<{ userId: string; otp: { requestId: string; expiresAt: string; devCode?: string }; note: string }>(
      "/auth/register/driver",
      input,
      { auth: false },
    ),

  verifyOtp: (requestId: string, code: string) =>
    api.post<{ purpose: string; user?: PublicUser; accessToken?: string; refreshToken?: string; resetToken?: string }>(
      "/auth/otp/verify",
      { requestId, code },
      { auth: false },
    ),

  requestOtp: (phone: string, purpose: "registration" | "login" | "reset_password") =>
    api.post<{ requestId: string; expiresAt: string; devCode?: string }>("/auth/otp/request", { phone, purpose }, { auth: false }),

  me: () => api.get<{ user: PublicUser; passengerProfile: unknown; driverProfile: unknown; adminProfile: unknown; wallet: unknown }>("/auth/me"),

  logout: (refreshToken: string) => api.post<void>("/auth/logout", { refreshToken }, { auth: false }),
}
