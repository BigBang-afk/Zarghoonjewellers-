import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"

/**
 * Phase 5 §23 — public status page, admin side. An incident is a title +
 * severity plus a timeline of updates (investigating -> identified ->
 * monitoring -> resolved); the incident's own `status`/`resolvedAt` always
 * mirror its latest update, so the public page and admin list can read
 * them directly without re-deriving from the update history each time.
 */
export const adminSystemStatusRouter = Router()

const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(150),
  affectedArea: z.string().trim().max(80).optional(),
  severity: z.enum(["minor", "major", "critical"]).default("minor"),
  message: z.string().trim().min(3).max(1000),
})

const addUpdateSchema = z.object({
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  message: z.string().trim().min(3).max(1000),
})

adminSystemStatusRouter.get(
  "/system-incidents",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined
    const incidents = await prisma.systemIncident.findMany({
      where: status ? { status } : undefined,
      include: { updates: { orderBy: { createdAt: "desc" }, include: { postedBy: { select: { fullName: true } } } } },
      orderBy: { startedAt: "desc" },
      take: 200,
    })
    res.json({ incidents })
  }),
)

adminSystemStatusRouter.post(
  "/system-incidents",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(createIncidentSchema),
  asyncHandler(async (req, res) => {
    const { message, ...rest } = req.body
    const incident = await prisma.systemIncident.create({
      data: {
        ...rest,
        createdById: req.auth!.userId,
        updates: { create: { status: "investigating", message, postedById: req.auth!.userId } },
      },
      include: { updates: true },
    })
    await writeAuditLog({ req, action: "system_incident.create", targetTable: "system_incidents", targetId: incident.id, after: req.body })
    res.status(201).json({ incident })
  }),
)

adminSystemStatusRouter.post(
  "/system-incidents/:id/updates",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(addUpdateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.systemIncident.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Incident not found.")

    const update = await prisma.systemIncidentUpdate.create({
      data: { incidentId: existing.id, status: req.body.status, message: req.body.message, postedById: req.auth!.userId },
    })
    const incident = await prisma.systemIncident.update({
      where: { id: existing.id },
      data: { status: req.body.status, resolvedAt: req.body.status === "resolved" ? new Date() : null },
      include: { updates: { orderBy: { createdAt: "desc" } } },
    })
    await writeAuditLog({ req, action: "system_incident.update", targetTable: "system_incidents", targetId: incident.id, before: existing, after: req.body })
    res.status(201).json({ incident, update })
  }),
)

adminSystemStatusRouter.delete(
  "/system-incidents/:id",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.systemIncident.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Incident not found.")
    await prisma.systemIncidentUpdate.deleteMany({ where: { incidentId: req.params.id } })
    await prisma.systemIncident.delete({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "system_incident.delete", targetTable: "system_incidents", targetId: req.params.id, before: existing })
    res.status(204).send()
  }),
)
