import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { getSetting, setSetting } from "../../config/settings.js"

/**
 * Pilot Mode admin controls (Phase 4 §37) — a controlled-launch gate an
 * admin can flip on for exactly one city, with driver/passenger supply
 * caps and optional invitation-only sign-up. A "beta user list" is just
 * a set of single-use (maxUses: 1) invitation codes, one per approved
 * person, rather than a separate allowlist table — same enforcement path,
 * no new mechanism to build or keep in sync.
 */
export const adminPilotModeRouter = Router()

const pilotModeSchema = z.object({
  enabled: z.boolean().optional(),
  cityId: z.string().uuid().or(z.literal("")).optional(),
  maxDriverCount: z.number().int().min(0).optional(),
  maxPassengerCount: z.number().int().min(0).optional(),
  requireInvitationCode: z.boolean().optional(),
})

adminPilotModeRouter.get(
  "/pilot-mode",
  asyncHandler(async (_req, res) => {
    const [enabled, cityId, maxDriverCount, maxPassengerCount, requireInvitationCode] = await Promise.all([
      getSetting("pilotMode.enabled"),
      getSetting("pilotMode.cityId"),
      getSetting("pilotMode.maxDriverCount"),
      getSetting("pilotMode.maxPassengerCount"),
      getSetting("pilotMode.requireInvitationCode"),
    ])
    const [driverCount, passengerCount] = await Promise.all([
      cityId ? prisma.driverProfile.count({ where: { cityId, deletedAt: null } }) : prisma.driverProfile.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { role: "passenger", deletedAt: null } }),
    ])
    res.json({
      settings: { enabled, cityId, maxDriverCount, maxPassengerCount, requireInvitationCode },
      current: { driverCount, passengerCount },
    })
  }),
)

adminPilotModeRouter.put(
  "/pilot-mode",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(pilotModeSchema),
  asyncHandler(async (req, res) => {
    const before = {
      enabled: await getSetting("pilotMode.enabled"),
      cityId: await getSetting("pilotMode.cityId"),
      maxDriverCount: await getSetting("pilotMode.maxDriverCount"),
      maxPassengerCount: await getSetting("pilotMode.maxPassengerCount"),
      requireInvitationCode: await getSetting("pilotMode.requireInvitationCode"),
    }
    if (req.body.enabled !== undefined) await setSetting("pilotMode.enabled", req.body.enabled)
    if (req.body.cityId !== undefined) await setSetting("pilotMode.cityId", req.body.cityId)
    if (req.body.maxDriverCount !== undefined) await setSetting("pilotMode.maxDriverCount", req.body.maxDriverCount)
    if (req.body.maxPassengerCount !== undefined) await setSetting("pilotMode.maxPassengerCount", req.body.maxPassengerCount)
    if (req.body.requireInvitationCode !== undefined) await setSetting("pilotMode.requireInvitationCode", req.body.requireInvitationCode)

    await writeAuditLog({ req, action: "pilot_mode.update", targetTable: "platform_settings", before, after: req.body })
    res.json({ settings: { ...before, ...req.body } })
  }),
)

// ---------------------------------------------------------------------
// Invitation codes (also used as the "beta user list" mechanism)
// ---------------------------------------------------------------------

adminPilotModeRouter.get(
  "/invitation-codes",
  asyncHandler(async (_req, res) => {
    const codes = await prisma.invitationCode.findMany({ orderBy: { createdAt: "desc" }, take: 500 })
    res.json({ codes })
  }),
)

adminPilotModeRouter.post(
  "/invitation-codes",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(
    z.object({
      code: z.string().trim().min(3).max(30).transform((s) => s.toUpperCase()),
      maxUses: z.number().int().positive().optional(),
      cityId: z.string().uuid().optional(),
      expiresAt: z.coerce.date().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.invitationCode.findUnique({ where: { code: req.body.code } })
    if (existing) throw ApiError.conflict("CODE_EXISTS", "An invitation code with this value already exists.")
    const invite = await prisma.invitationCode.create({ data: req.body })
    await writeAuditLog({ req, action: "invitation_code.create", targetTable: "invitation_codes", targetId: invite.id, after: req.body })
    res.status(201).json({ invite })
  }),
)

adminPilotModeRouter.patch(
  "/invitation-codes/:id",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(z.object({ isActive: z.boolean().optional(), maxUses: z.number().int().positive().optional() })),
  asyncHandler(async (req, res) => {
    const before = await prisma.invitationCode.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Invitation code not found.")
    const invite = await prisma.invitationCode.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "invitation_code.update", targetTable: "invitation_codes", targetId: invite.id, before, after: req.body })
    res.json({ invite })
  }),
)
