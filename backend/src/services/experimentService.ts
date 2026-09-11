import { createHash } from "node:crypto"
import { prisma } from "../utils/prisma.js"

/**
 * Phase 5 §22 — A/B testing foundation. Unlike feature flags (dynamic
 * per-call re-evaluation), experiment assignment is *sticky*: once a user
 * is bucketed into a variant, that choice is persisted in
 * ExperimentAssignment and reused forever, even if variant weights change
 * afterward. That's the whole point of an A/B test — a user must keep
 * seeing the same variant for the life of the experiment.
 */

export interface Variant {
  key: string
  name: string
  weight: number
}

export interface ExperimentEvalContext {
  userId: string
  role: "passenger" | "driver" | "admin"
  cityId?: string | null
}

function parseVariants(raw: string): Variant[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function bucketFor(userId: string, key: string): number {
  const hash = createHash("sha256").update(`experiment:${key}:${userId}`).digest("hex")
  return parseInt(hash.slice(0, 8), 16) % 100
}

/** Picks a variant by cumulative weight using the deterministic bucket — same inputs always pick the same variant. */
function pickVariant(variants: Variant[], userId: string, key: string): string | null {
  if (variants.length === 0) return null
  const bucket = bucketFor(userId, key)
  let cumulative = 0
  for (const v of variants) {
    cumulative += v.weight
    if (bucket < cumulative) return v.key
  }
  // Weights summed to < 100 (shouldn't happen given create-time validation) — fall back to the last variant.
  return variants[variants.length - 1].key
}

function eligible(experiment: { status: string; targetRole: string; cityIds: string | null }, ctx: ExperimentEvalContext): boolean {
  if (experiment.status !== "running") return false
  if (experiment.targetRole !== "all" && experiment.targetRole !== ctx.role) return false
  if (experiment.cityIds) {
    let allowed: string[] = []
    try {
      allowed = JSON.parse(experiment.cityIds)
    } catch {
      allowed = []
    }
    if (allowed.length > 0 && (!ctx.cityId || !allowed.includes(ctx.cityId))) return false
  }
  return true
}

/**
 * Evaluates one experiment for a user: returns the sticky assignment if one
 * exists, otherwise buckets the user, persists the assignment, and returns
 * it. Returns null if the experiment doesn't exist, isn't running, or the
 * user isn't targeted — a user who becomes ineligible after being assigned
 * keeps their existing assignment (never un-assigned).
 */
export async function getVariantAssignment(key: string, ctx: ExperimentEvalContext): Promise<string | null> {
  const experiment = await prisma.experiment.findUnique({ where: { key } })
  if (!experiment) return null

  const existing = await prisma.experimentAssignment.findUnique({
    where: { experimentId_userId: { experimentId: experiment.id, userId: ctx.userId } },
  })
  if (existing) return existing.variantKey

  if (!eligible(experiment, ctx)) return null

  const variants = parseVariants(experiment.variants)
  const variantKey = pickVariant(variants, ctx.userId, experiment.key)
  if (!variantKey) return null

  try {
    const assignment = await prisma.experimentAssignment.create({
      data: { experimentId: experiment.id, userId: ctx.userId, variantKey },
    })
    return assignment.variantKey
  } catch {
    // Unique constraint race — another request created it first; read it back.
    const raceWinner = await prisma.experimentAssignment.findUnique({
      where: { experimentId_userId: { experimentId: experiment.id, userId: ctx.userId } },
    })
    return raceWinner?.variantKey ?? null
  }
}

/** Evaluates every running experiment for one user — what a client fetches once at session start. */
export async function evaluateAllExperimentsForUser(ctx: ExperimentEvalContext): Promise<Record<string, string>> {
  const experiments = await prisma.experiment.findMany({ where: { status: "running" } })
  const out: Record<string, string> = {}
  for (const experiment of experiments) {
    const variantKey = await getVariantAssignment(experiment.key, ctx)
    if (variantKey) out[experiment.key] = variantKey
  }
  return out
}

/** Per-variant assignment counts for an experiment's admin detail view. */
export async function getExperimentResults(experimentId: string) {
  const counts = await prisma.experimentAssignment.groupBy({
    by: ["variantKey"],
    where: { experimentId },
    _count: { _all: true },
  })
  return counts.map((c) => ({ variantKey: c.variantKey, assignedCount: c._count._all }))
}
