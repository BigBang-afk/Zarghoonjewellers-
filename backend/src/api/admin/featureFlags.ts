import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"

/** Phase 5 §21 — feature flags admin CRUD. See featureFlagService.ts for evaluation logic. */
export const adminFeatureFlagsRouter = Router()

const flagSchema = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_.-]+$/, "Use lowercase letters, numbers, dots, dashes, or underscores only."),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  isEnabled: z.boolean().default(false),
  rolloutPct: z.number().int().min(0).max(100).default(100),
  targetRole: z.enum(["all", "passenger", "driver"]).default("all"),
  cityIds: z.array(z.string().uuid()).optional(),
})

function serialize(flag: { cityIds: string | null }) {
  return { ...flag, cityIds: flag.cityIds ? JSON.parse(flag.cityIds) : [] }
}

adminFeatureFlagsRouter.get(
  "/feature-flags",
  asyncHandler(async (_req, res) => {
    const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } })
    res.json({ flags: flags.map(serialize) })
  }),
)

adminFeatureFlagsRouter.post(
  "/feature-flags",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(flagSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.featureFlag.findUnique({ where: { key: req.body.key } })
    if (existing) throw ApiError.conflict("FLAG_KEY_EXISTS", "A flag with this key already exists.")

    const { cityIds, ...rest } = req.body
    const flag = await prisma.featureFlag.create({ data: { ...rest, cityIds: cityIds?.length ? JSON.stringify(cityIds) : null } })
    await writeAuditLog({ req, action: "feature_flag.create", targetTable: "feature_flags", targetId: flag.id, after: req.body })
    res.status(201).json({ flag: serialize(flag) })
  }),
)

adminFeatureFlagsRouter.patch(
  "/feature-flags/:id",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(flagSchema.omit({ key: true }).partial()),
  asyncHandler(async (req, res) => {
    const existing = await prisma.featureFlag.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Feature flag not found.")

    const { cityIds, ...rest } = req.body
    const flag = await prisma.featureFlag.update({
      where: { id: req.params.id },
      data: { ...rest, ...(cityIds !== undefined ? { cityIds: cityIds.length ? JSON.stringify(cityIds) : null } : {}) },
    })
    await writeAuditLog({ req, action: "feature_flag.update", targetTable: "feature_flags", targetId: flag.id, before: existing, after: req.body })
    res.json({ flag: serialize(flag) })
  }),
)

adminFeatureFlagsRouter.delete(
  "/feature-flags/:id",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.featureFlag.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Feature flag not found.")
    await prisma.featureFlag.delete({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "feature_flag.delete", targetTable: "feature_flags", targetId: req.params.id, before: existing })
    res.status(204).send()
  }),
)
