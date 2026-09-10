import { prisma } from "../utils/prisma.js"
import { logger } from "../utils/logger.js"

/**
 * Cleanup sweep (Phase 4 §28) — purges rows that are only ever useful
 * for a short window after they expire: revokes refresh tokens past
 * their expiry (so a stolen-but-expired token can't linger as "active"
 * in a query), and deletes OTP codes that expired without being
 * consumed. Both are safe to run repeatedly (idempotent) — a row already
 * revoked/deleted is simply not matched again.
 */
const OTP_RETENTION_MS = 24 * 60 * 60 * 1000

export async function runCleanupSweep(): Promise<void> {
  const now = new Date()

  const revoked = await prisma.refreshToken.updateMany({
    where: { revokedAt: null, expiresAt: { lt: now } },
    data: { revokedAt: now },
  })

  const otpCutoff = new Date(now.getTime() - OTP_RETENTION_MS)
  const deletedOtps = await prisma.otpCode.deleteMany({
    where: { expiresAt: { lt: otpCutoff } },
  })

  if (revoked.count > 0 || deletedOtps.count > 0) {
    logger.info("cleanup_sweep", { revokedRefreshTokens: revoked.count, deletedOtpCodes: deletedOtps.count })
  }
}
