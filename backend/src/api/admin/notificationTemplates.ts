import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { DEFAULT_TEMPLATES } from "../../services/notifications/templates.js"

/**
 * Notification template management (Phase 4 §19) — lets an admin change
 * notification wording (and add a new locale) without a deploy. Every
 * key/locale pair not overridden here still works, falling back to the
 * in-code default in templates.ts.
 */
export const adminNotificationTemplateRouter = Router()

adminNotificationTemplateRouter.get(
  "/notification-templates",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.notificationTemplate.findMany({ orderBy: [{ key: "asc" }, { locale: "asc" }] })
    const defaultKeys = Object.keys(DEFAULT_TEMPLATES)
    res.json({ templates: rows, availableKeys: defaultKeys })
  }),
)

const templateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  locale: z.string().trim().min(2).max(10),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
})

adminNotificationTemplateRouter.put(
  "/notification-templates",
  requireAdminRole("super_admin", "ops_manager", "marketing"),
  validateBody(templateSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.notificationTemplate.findUnique({ where: { key_locale: { key: req.body.key, locale: req.body.locale } } })
    const template = await prisma.notificationTemplate.upsert({
      where: { key_locale: { key: req.body.key, locale: req.body.locale } },
      create: req.body,
      update: { title: req.body.title, body: req.body.body },
    })
    await writeAuditLog({ req, action: "notification_template.upsert", targetTable: "notification_templates", targetId: template.id, before, after: req.body })
    res.status(201).json({ template })
  }),
)

adminNotificationTemplateRouter.delete(
  "/notification-templates/:id",
  requireAdminRole("super_admin", "ops_manager", "marketing"),
  asyncHandler(async (req, res) => {
    const template = await prisma.notificationTemplate.findUnique({ where: { id: req.params.id } })
    if (!template) throw ApiError.notFound("Template not found.")
    await prisma.notificationTemplate.delete({ where: { id: template.id } })
    await writeAuditLog({ req, action: "notification_template.delete", targetTable: "notification_templates", targetId: template.id, before: template })
    res.status(204).send()
  }),
)
