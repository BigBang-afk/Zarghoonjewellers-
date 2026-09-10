import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"

/**
 * Blocking (Phase 3 §15) — only two people who have actually shared a
 * ride can block each other, and a block only ever affects future
 * matching between that pair; it is never a platform-wide penalty.
 */
export async function blockUser(blockerUserId: string, blockedUserId: string, reason?: string) {
  if (blockerUserId === blockedUserId) throw ApiError.badRequest("CANNOT_BLOCK_SELF", "You can't block yourself.")

  const sharedRide = await prisma.ride.findFirst({
    where: {
      OR: [
        { passenger: { userId: blockerUserId }, driver: { userId: blockedUserId } },
        { passenger: { userId: blockedUserId }, driver: { userId: blockerUserId } },
      ],
    },
  })
  if (!sharedRide) throw ApiError.badRequest("NO_SHARED_RIDE", "You can only block someone you've shared a ride with.")

  return prisma.userBlock.upsert({
    where: { blockerUserId_blockedUserId: { blockerUserId, blockedUserId } },
    create: { blockerUserId, blockedUserId, reason },
    update: { reason },
  })
}

export async function unblockUser(blockerUserId: string, blockedUserId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerUserId, blockedUserId } })
}

export async function listBlocks(blockerUserId: string) {
  return prisma.userBlock.findMany({ where: { blockerUserId }, include: { blocked: { select: { fullName: true, id: true } } } })
}

/** Driver userIds this passenger has blocked, or has been blocked by — excluded from both directions of matching. */
export async function getMutuallyBlockedUserIds(userId: string): Promise<string[]> {
  const [initiated, received] = await Promise.all([
    prisma.userBlock.findMany({ where: { blockerUserId: userId }, select: { blockedUserId: true } }),
    prisma.userBlock.findMany({ where: { blockedUserId: userId }, select: { blockerUserId: true } }),
  ])
  return [...initiated.map((b) => b.blockedUserId), ...received.map((b) => b.blockerUserId)]
}
