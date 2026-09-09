import { prisma } from "../utils/prisma.js"

/**
 * Platform-wide, admin-configurable settings — backed by the
 * `platform_settings` table (editable from Admin → Settings). Every value
 * that Phase 2 explicitly calls out as "do not hard-code" lives here, with
 * an in-code default used only until an admin (or the seed script)
 * writes a row.
 *
 * Reads are cached in-process for a few seconds to avoid a DB round trip
 * on every request in hot paths (matching, fare calc) while still picking
 * up admin edits quickly.
 */

export interface PlatformSettingsShape {
  "matching.initialRadiusKm": number
  "matching.radiusExpansionStepsKm": number[]
  "matching.maxRadiusKm": number
  "matching.quickMatchDispatchTimeoutSec": number
  "matching.competitiveOfferMaxDrivers": number
  "negotiation.offerExpirySec": number
  "negotiation.counterOfferExpirySec": number
  "negotiation.requestExpiryMinutes": number
  "fare.defaultCommissionRate": number
  "fare.demandMultiplierMin": number
  "fare.demandMultiplierMax": number
}

const DEFAULTS: PlatformSettingsShape = {
  "matching.initialRadiusKm": 5,
  "matching.radiusExpansionStepsKm": [5, 8, 12, 20],
  "matching.maxRadiusKm": 20,
  "matching.quickMatchDispatchTimeoutSec": 20,
  "matching.competitiveOfferMaxDrivers": 8,
  "negotiation.offerExpirySec": 90,
  "negotiation.counterOfferExpirySec": 90,
  "negotiation.requestExpiryMinutes": 5,
  "fare.defaultCommissionRate": 0.15,
  "fare.demandMultiplierMin": 1.0,
  "fare.demandMultiplierMax": 2.5,
}

const CACHE_TTL_MS = 5_000
let cache: Partial<PlatformSettingsShape> | null = null
let cacheLoadedAt = 0

async function loadFromDb(): Promise<Partial<PlatformSettingsShape>> {
  const rows = await prisma.platformSetting.findMany()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
    } catch {
      // corrupt/manual edit — ignore and fall back to default for this key
    }
  }
  return out as Partial<PlatformSettingsShape>
}

async function ensureCache(): Promise<void> {
  const now = Date.now()
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return
  cache = await loadFromDb()
  cacheLoadedAt = now
}

export async function getSetting<K extends keyof PlatformSettingsShape>(
  key: K,
): Promise<PlatformSettingsShape[K]> {
  await ensureCache()
  return (cache?.[key] as PlatformSettingsShape[K] | undefined) ?? DEFAULTS[key]
}

export async function getAllSettings(): Promise<PlatformSettingsShape> {
  await ensureCache()
  return { ...DEFAULTS, ...cache }
}

export async function setSetting<K extends keyof PlatformSettingsShape>(
  key: K,
  value: PlatformSettingsShape[K],
  description?: string,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value), description },
    update: { value: JSON.stringify(value), ...(description ? { description } : {}) },
  })
  cache = null // force reload on next read
}

export function invalidateSettingsCache(): void {
  cache = null
}

export const SETTINGS_DEFAULTS = DEFAULTS
