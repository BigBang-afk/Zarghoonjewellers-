import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unreadOnly === "true"
    const notifications = await prisma.notification.findMany({
      where: { userId: req.auth!.userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    const unreadCount = await prisma.notification.count({ where: { userId: req.auth!.userId, read: false } })
    res.json({ notifications, unreadCount })
  }),
)

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } })
    if (!notification || notification.userId !== req.auth!.userId) throw ApiError.notFound("Notification not found.")
    const updated = await prisma.notification.update({ where: { id: notification.id }, data: { read: true } })
    res.json({ notification: updated })
  }),
)

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.auth!.userId, read: false }, data: { read: true } })
    res.json({ ok: true })
  }),
)
