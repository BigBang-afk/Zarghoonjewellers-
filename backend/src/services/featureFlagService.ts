import { createHash } from "node:crypto"
import { prisma } from "../utils/prisma.js"

/**
 * Phase 5 §21 — feature flags. Percentage rollout is deterministic per
 * (userId, flagKey) via a stable hash, not Math.random() — the same user
 * gets the same in/out result on every call and across server restarts,
 * rather than flapping between "sees it" and "doesn't" on each check.
 */
function bucketFor(userId: string, key: string): number {
  const hash = createHash("sha256").update(`${key}:${userId}`).digest("hex")
  // First 8 hex chars as a uint, modulo 100 — uniform enough for a rollout bucket, no need for anything fancier.
  return parseInt(hash.slice(0, 8), 16) % 100
}

export interface FlagEvalContext {
  userId: string
  role: "passenger" | "driver" | "admin"
  cityId?: string | null
}

function evaluate(flag: { isEnabled: boolean; rolloutPct: number; targetRole: string; cityIds: string | null }, ctx: FlagEvalContext, key: string): boolean {
  if (!flag.isEnabled) return false
  if (flag.targetRole !== "all" && flag.targetRole !== ctx.role) return false
  if (flag.cityIds) {
    let allowed: string[] = []
    try {
      allowed = JSON.parse(flag.cityIds)
    } catch {
      allowed = []
    }
    if (allowed.length > 0 && (!ctx.cityId || !allowed.includes(ctx.cityId))) return false
  }
  if (flag.rolloutPct >= 100) return true
  if (flag.rolloutPct <= 0) return false
  return bucketFor(ctx.userId, key) < flag.rolloutPct
}

/** Evaluates a single flag by key for one user — returns false if the flag doesn't exist (never throws, so a missing flag just means "off"). */
export async function isFeatureEnabled(key: string, ctx: FlagEvalContext): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key } })
  if (!flag) return false
  return evaluate(flag, ctx, key)
}

/** Evaluates every flag for one user in a single query — what a client fetches once at session start. */
export async function evaluateAllFlagsForUser(ctx: FlagEvalContext): Promise<Record<string, boolean>> {
  const flags = await prisma.featureFlag.findMany()
  const out: Record<string, boolean> = {}
  for (const flag of flags) {
    out[flag.key] = evaluate(flag, ctx, flag.key)
  }
  return out
}
