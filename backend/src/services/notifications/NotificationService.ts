import { prisma } from "../../utils/prisma.js"
import { emitToUser } from "../../realtime/socket.js"
import { consoleEmailProvider, consolePushProvider, consoleSmsProvider } from "./ConsoleProviders.js"
import type { NotificationType } from "../../types/enums.js"

export interface NotifyInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  data?: Record<string, unknown>
  /** also fan out to SMS/push channels, not just in-app — for high-priority events */
  external?: boolean
  toPhone?: string
}

/**
 * The one real, always-on notification path: writes a `Notification` row
 * (so it survives a missed socket connection and shows in Notifications
 * screens) and pushes it over the realtime gateway. External SMS/push/
 * email fan-out uses the console mock providers in dev — see
 * services/notifications/ConsoleProviders.ts and .env.example for what a
 * production swap needs.
 */
export async function notify(input: NotifyInput) {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ? JSON.stringify(input.data) : null,
    },
  })

  emitToUser(input.userId, "notification.created", {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: input.data ?? null,
    createdAt: notification.createdAt,
  })

  if (input.external) {
    if (input.toPhone) {
      await consoleSmsProvider.send({ to: input.toPhone, title: input.title, body: input.body ?? "" })
    }
    await consolePushProvider.send({ to: input.userId, title: input.title, body: input.body ?? "" })
  }

  return notification
}

export const emailProvider = consoleEmailProvider
