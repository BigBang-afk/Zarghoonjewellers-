import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"

export async function getPassengerProfileOrThrow(userId: string) {
  const profile = await prisma.passengerProfile.findUnique({ where: { userId } })
  if (!profile) throw ApiError.forbidden("No passenger profile for this account.")
  return profile
}

export async function getDriverProfileOrThrow(userId: string) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } })
  if (!profile) throw ApiError.forbidden("No driver profile for this account.")
  return profile
}
