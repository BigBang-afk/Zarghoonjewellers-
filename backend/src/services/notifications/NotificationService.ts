import { prisma } from "../../utils/prisma.js"
import { emitToUser } from "../../realtime/socket.js"
import { consoleEmailProvider, consolePushProvider, consoleSmsProvider } from "./ConsoleProviders.js"
import { renderTemplate } from "./templates.js"
import { recordFailure } from "../observability.js"
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
/** Safety and account/system notifications can never be silently disabled (Phase 2 §20). */
const NON_DISABLEABLE_TYPES: NotificationType[] = ["safety", "system"]

export async function notify(input: NotifyInput) {
  if (!NON_DISABLEABLE_TYPES.includes(input.type)) {
    const preference = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
    })
    if (preference && !preference.enabled) return null
  }

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
    // The external channels are best-effort fan-out: the in-app row and
    // socket push above already delivered the notification, so a
    // provider failure here is tracked, not thrown — never blocks the
    // caller's own request (e.g. a ride status update) on an SMS outage.
    try {
      if (input.toPhone) {
        await consoleSmsProvider.send({ to: input.toPhone, title: input.title, body: input.body ?? "" })
      }
      await consolePushProvider.send({ to: input.userId, title: input.title, body: input.body ?? "" })
    } catch (err) {
      recordFailure("notification_failures", { userId: input.userId, type: input.type, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return notification
}

/**
 * Locale-aware notification (Phase 4 §2/§19) — resolves the recipient's
 * `User.locale`, renders the admin-editable (or in-code default) template
 * for `templateKey`, and sends it through the same real `notify()` path
 * above (preferences, socket push, DB row — all unchanged).
 */
export async function notifyFromTemplate(input: {
  userId: string
  templateKey: string
  vars?: Record<string, string | number>
  type: NotificationType
  data?: Record<string, unknown>
  external?: boolean
  toPhone?: string
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { locale: true } })
  const rendered = await renderTemplate(input.templateKey, user?.locale ?? "en", input.vars ?? {})
  return notify({
    userId: input.userId,
    type: input.type,
    title: rendered.title,
    body: rendered.body,
    data: input.data,
    external: input.external,
    toPhone: input.toPhone,
  })
}

export const emailProvider = consoleEmailProvider
