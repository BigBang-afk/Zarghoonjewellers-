import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { getExperimentResults } from "../../services/experimentService.js"

/** Phase 5 §22 — A/B testing admin CRUD. See experimentService.ts for sticky assignment logic. */
export const adminExperimentsRouter = Router()

const variantSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_.-]+$/, "Use lowercase letters, numbers, dots, dashes, or underscores only."),
  name: z.string().trim().min(1).max(80),
  weight: z.number().int().min(0).max(100),
})

const variantsRefinement = (variants: z.infer<typeof variantSchema>[], ctx: z.RefinementCtx) => {
  const keys = new Set(variants.map((v) => v.key))
  if (keys.size !== variants.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Variant keys must be unique." })
  }
  const total = variants.reduce((sum, v) => sum + v.weight, 0)
  if (total !== 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Variant weights must sum to 100 (got ${total}).` })
  }
}

const createSchema = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_.-]+$/, "Use lowercase letters, numbers, dots, dashes, or underscores only."),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  variants: z.array(variantSchema).min(2).max(6).superRefine(variantsRefinement),
  targetRole: z.enum(["all", "passenger", "driver"]).default("all"),
  cityIds: z.array(z.string().uuid()).optional(),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["draft", "running", "completed"]).optional(),
  targetRole: z.enum(["all", "passenger", "driver"]).optional(),
  cityIds: z.array(z.string().uuid()).optional(),
  // Weight changes only — never affects already-assigned users (sticky assignment).
  variants: z.array(variantSchema).min(2).max(6).superRefine(variantsRefinement).optional(),
})

function serialize(experiment: { variants: string; cityIds: string | null }) {
  return { ...experiment, variants: JSON.parse(experiment.variants), cityIds: experiment.cityIds ? JSON.parse(experiment.cityIds) : [] }
}

adminExperimentsRouter.get(
  "/experiments",
  asyncHandler(async (_req, res) => {
    const experiments = await prisma.experiment.findMany({ orderBy: { createdAt: "desc" } })
    res.json({ experiments: experiments.map(serialize) })
  }),
)

adminExperimentsRouter.get(
  "/experiments/:id",
  asyncHandler(async (req, res) => {
    const experiment = await prisma.experiment.findUnique({ where: { id: req.params.id } })
    if (!experiment) throw ApiError.notFound("Experiment not found.")
    const results = await getExperimentResults(experiment.id)
    const totalAssigned = results.reduce((sum, r) => sum + r.assignedCount, 0)
    res.json({ experiment: serialize(experiment), results, totalAssigned })
  }),
)

adminExperimentsRouter.post(
  "/experiments",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.experiment.findUnique({ where: { key: req.body.key } })
    if (existing) throw ApiError.conflict("EXPERIMENT_KEY_EXISTS", "An experiment with this key already exists.")

    const { cityIds, variants, ...rest } = req.body
    const experiment = await prisma.experiment.create({
      data: { ...rest, variants: JSON.stringify(variants), cityIds: cityIds?.length ? JSON.stringify(cityIds) : null },
    })
    await writeAuditLog({ req, action: "experiment.create", targetTable: "experiments", targetId: experiment.id, after: req.body })
    res.status(201).json({ experiment: serialize(experiment) })
  }),
)

adminExperimentsRouter.patch(
  "/experiments/:id",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Experiment not found.")
    if (existing.status === "completed") throw ApiError.badRequest("EXPERIMENT_COMPLETED", "A completed experiment can no longer be edited.")

    const { cityIds, variants, ...rest } = req.body
    const experiment = await prisma.experiment.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(variants !== undefined ? { variants: JSON.stringify(variants) } : {}),
        ...(cityIds !== undefined ? { cityIds: cityIds.length ? JSON.stringify(cityIds) : null } : {}),
      },
    })
    await writeAuditLog({ req, action: "experiment.update", targetTable: "experiments", targetId: experiment.id, before: existing, after: req.body })
    res.json({ experiment: serialize(experiment) })
  }),
)

adminExperimentsRouter.delete(
  "/experiments/:id",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.experiment.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Experiment not found.")
    await prisma.experimentAssignment.deleteMany({ where: { experimentId: req.params.id } })
    await prisma.experiment.delete({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "experiment.delete", targetTable: "experiments", targetId: req.params.id, before: existing })
    res.status(204).send()
  }),
)
