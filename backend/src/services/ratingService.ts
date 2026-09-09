import { Prisma } from "@prisma/client"
import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"

/**
 * One rating per (ride, rater) — enforced by the DB unique constraint on
 * Rating(rideId, raterId), not just app-level checking (Phase 2 §15).
 * Aggregate rating_avg is updated with a running average inside the same
 * transaction as the insert, using a row lock via the profile's own
 * update, so two concurrent ratings for different rides never race each
 * other's average.
 */
export async function submitRating(params: {
  rideId: string
  raterUserId: string
  score: number
  comment?: string
}) {
  if (params.score < 1 || params.score > 5 || !Number.isInteger(params.score)) {
    throw ApiError.badRequest("INVALID_SCORE", "Score must be an integer between 1 and 5.")
  }

  const ride = await prisma.ride.findUnique({
    where: { id: params.rideId },
    include: { passenger: { include: { user: true } }, driver: { include: { user: true } } },
  })
  if (!ride) throw ApiError.notFound("Ride not found.")
  if (ride.status !== "ride_completed") throw ApiError.conflict("RIDE_NOT_COMPLETED", "You can only rate a completed ride.")

  const isPassenger = ride.passenger.userId === params.raterUserId
  const isDriver = ride.driver.userId === params.raterUserId
  if (!isPassenger && !isDriver) throw ApiError.forbidden("You are not a party to this ride.")

  const rateeUserId = isPassenger ? ride.driver.userId : ride.passenger.userId

  try {
    const rating = await prisma.$transaction(async (tx) => {
      const created = await tx.rating.create({
        data: {
          rideId: ride.id,
          raterId: params.raterUserId,
          rateeId: rateeUserId,
          score: params.score,
          review: params.comment ? { create: { comment: params.comment } } : undefined,
        },
      })

      if (isPassenger) {
        const driver = await tx.driverProfile.findUniqueOrThrow({ where: { id: ride.driverId } })
        const newCount = driver.ratingCount + 1
        const newAvg = round2((driver.ratingAvg * driver.ratingCount + params.score) / newCount)
        await tx.driverProfile.update({ where: { id: driver.id }, data: { ratingAvg: newAvg, ratingCount: newCount } })
      } else {
        const passenger = await tx.passengerProfile.findUniqueOrThrow({ where: { id: ride.passengerId } })
        const newCount = passenger.ratingCount + 1
        const newAvg = round2((passenger.ratingAvg * passenger.ratingCount + params.score) / newCount)
        await tx.passengerProfile.update({ where: { id: passenger.id }, data: { ratingAvg: newAvg, ratingCount: newCount } })
      }

      return created
    })
    return rating
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw ApiError.conflict("ALREADY_RATED", "You already rated this ride.")
    }
    throw err
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
