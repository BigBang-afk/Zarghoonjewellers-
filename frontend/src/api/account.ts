import { api } from "./client"

export const accountApi = {
  setLocale: (locale: string) => api.patch<{ locale: string }>("/account/locale", { locale }),
}
