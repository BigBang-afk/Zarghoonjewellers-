import { createHash, randomBytes } from "node:crypto"
import jwt from "jsonwebtoken"
import { env } from "../config/env.js"
import { prisma } from "./prisma.js"
import type { UserRole, AdminRole } from "../types/enums.js"

export interface AccessTokenClaims {
  sub: string // user id
  role: UserRole
  adminRole?: AdminRole
  cityScope?: string | null
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl as jwt.SignOptions["expiresIn"] })
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.jwtAccessSecret) as unknown as AccessTokenClaims
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl)
  if (!match) return 30 * 24 * 60 * 60 * 1000
  const value = Number(match[1])
  const unit = match[2]
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000
  return value * unitMs
}

/** Opaque, rotating refresh token. We store only its hash (never the raw value). */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(48).toString("hex")
  const tokenHash = createHash("sha256").update(raw).digest("hex")
  const expiresAt = new Date(Date.now() + ttlToMs(env.jwtRefreshTtl))
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } })
  return raw
}

export async function rotateRefreshToken(rawToken: string): Promise<{ userId: string; newToken: string }> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex")
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new Error("INVALID_REFRESH_TOKEN")
  }
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } })
  const newToken = await issueRefreshToken(record.userId)
  return { userId: record.userId, newToken }
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex")
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
