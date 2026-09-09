import { api } from "./client"
import type { NotificationItem } from "../types"

export const notificationsApi = {
  list: (unreadOnly?: boolean) => api.get<{ notifications: NotificationItem[]; unreadCount: number }>("/notifications", unreadOnly ? { unreadOnly: true } : undefined),
  markRead: (id: string) => api.post<{ notification: NotificationItem }>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ ok: boolean }>("/notifications/read-all"),
}
