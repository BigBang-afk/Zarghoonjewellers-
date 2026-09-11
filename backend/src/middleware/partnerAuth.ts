import { ApiError } from "../utils/apiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { authenticatePartnerApiKey } from "../services/partnerApiKeyService.js"
import type { Partner } from "@prisma/client"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: Partner
    }
  }
}

/**
 * Phase 5 §20 — authenticates a scoped Partner API request via
 * `Authorization: Bearer rivo_partner_<secret>`, entirely separate from
 * the JWT-based req.auth used by app users/admins. Populates req.partner.
 * Wrapped in asyncHandler — an async Express middleware that throws
 * instead of calling next(err) crashes the process (no catch site),
 * unlike an async *route handler* registered directly, which Express
 * itself awaits.
 */
export const requirePartnerApiKey = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized("Missing partner API key.")
  const partner = await authenticatePartnerApiKey(header.slice("Bearer ".length))
  if (!partner) throw ApiError.unauthorized("Invalid or revoked partner API key.")
  req.partner = partner
  next()
})
