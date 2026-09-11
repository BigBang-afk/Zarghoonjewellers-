import { createHash, randomBytes } from "node:crypto"
import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import type { Partner } from "@prisma/client"

/**
 * Phase 5 §20 — scoped partner API platform. Same "store only the hash"
 * pattern as RefreshToken (utils/jwt.ts): the raw key is shown to the
 * admin exactly once at generation time and never persisted or
 * retrievable again — losing it means generating a new one.
 */
const KEY_PREFIX = "rivo_partner_"

export async function generatePartnerApiKey(partnerId: string): Promise<{ rawKey: string }> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } })
  if (!partner) throw ApiError.notFound("Partner not found.")

  const secret = randomBytes(32).toString("hex")
  const rawKey = `${KEY_PREFIX}${secret}`
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex")

  await prisma.partner.update({
    where: { id: partnerId },
    data: { apiKeyHash, apiKeyPrefix: rawKey.slice(0, KEY_PREFIX.length + 8), apiEnabled: true, apiKeyCreatedAt: new Date() },
  })

  return { rawKey }
}

export async function revokePartnerApiKey(partnerId: string): Promise<void> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } })
  if (!partner) throw ApiError.notFound("Partner not found.")
  await prisma.partner.update({ where: { id: partnerId }, data: { apiEnabled: false, apiKeyHash: null, apiKeyPrefix: null } })
}

/** Looks up the Partner owning a raw API key — null if invalid, revoked, or inactive. */
export async function authenticatePartnerApiKey(rawKey: string): Promise<Partner | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex")
  const partner = await prisma.partner.findUnique({ where: { apiKeyHash } })
  if (!partner || !partner.apiEnabled || !partner.isActive) return null
  return partner
}
