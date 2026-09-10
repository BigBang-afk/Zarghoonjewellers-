import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"

/**
 * Pilot Mode (Phase 4 §37) — a controlled-launch gate checked at
 * registration. Off by default; an admin turns it on for the one pilot
 * city named in the spec ("keep the initial launch configuration focused
 * on ONE pilot city"). Zone/vehicle-type scoping already lives on
 * ServiceZone/CityVehicleType — this only adds supply caps and an
 * optional invitation-code requirement.
 */
export async function enforcePilotModeForRegistration(params: {
  role: "passenger" | "driver"
  cityId?: string
  invitationCode?: string
}): Promise<void> {
  const enabled = await getSetting("pilotMode.enabled")
  if (!enabled) return

  const pilotCityId = await getSetting("pilotMode.cityId")
  // A driver registers into a specific city; a passenger doesn't declare
  // one at signup, so the cap below only applies to drivers when the
  // pilot city is set and matches. Passengers are capped platform-wide
  // for the duration of the pilot (the platform IS the pilot city then).
  if (params.role === "driver" && pilotCityId && params.cityId && params.cityId !== pilotCityId) {
    throw ApiError.forbidden("Driver sign-ups are currently limited to the pilot city.")
  }

  // Capacity is checked before the invitation code is consumed — a
  // single-use beta code should never be burned by a registration that
  // was always going to be rejected for being over-capacity.
  if (params.role === "driver") {
    const maxDrivers = await getSetting("pilotMode.maxDriverCount")
    if (maxDrivers > 0) {
      const count = await prisma.driverProfile.count({
        where: { deletedAt: null, ...(pilotCityId ? { cityId: pilotCityId } : {}) },
      })
      if (count >= maxDrivers) {
        throw ApiError.forbidden("Driver sign-ups have reached the pilot's capacity. Please check back later.")
      }
    }
  } else {
    const maxPassengers = await getSetting("pilotMode.maxPassengerCount")
    if (maxPassengers > 0) {
      const count = await prisma.user.count({ where: { role: "passenger", deletedAt: null } })
      if (count >= maxPassengers) {
        throw ApiError.forbidden("Passenger sign-ups have reached the pilot's capacity. Please check back later.")
      }
    }
  }

  const requireCode = await getSetting("pilotMode.requireInvitationCode")
  if (requireCode) {
    if (!params.invitationCode) {
      throw ApiError.badRequest("INVITATION_CODE_REQUIRED", "An invitation code is required to sign up right now.")
    }
    await consumeInvitationCode(params.invitationCode, params.cityId)
  }
}

/**
 * Validates and atomically increments usedCount — a transaction so two
 * simultaneous sign-ups with the last remaining use of a maxUses code
 * can't both succeed (the same race-safety pattern as promo redemption).
 */
async function consumeInvitationCode(code: string, cityId?: string): Promise<void> {
  const normalized = code.trim().toUpperCase()
  await prisma.$transaction(async (tx) => {
    const invite = await tx.invitationCode.findUnique({ where: { code: normalized } })
    if (!invite) throw ApiError.badRequest("INVALID_INVITATION_CODE", "This invitation code isn't valid.")
    if (!invite.isActive) throw ApiError.badRequest("INVITATION_CODE_INACTIVE", "This invitation code is no longer active.")
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw ApiError.badRequest("INVITATION_CODE_EXPIRED", "This invitation code has expired.")
    }
    if (invite.cityId && cityId && invite.cityId !== cityId) {
      throw ApiError.badRequest("INVITATION_CODE_WRONG_CITY", "This invitation code isn't valid for this city.")
    }
    if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
      throw ApiError.badRequest("INVITATION_CODE_EXHAUSTED", "This invitation code has already been used up.")
    }
    await tx.invitationCode.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 } } })
  })
}
