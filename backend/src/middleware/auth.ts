import type { NextFunction, Request, Response } from "express"
import { verifyAccessToken } from "../utils/jwt.js"
import { ApiError } from "../utils/apiError.js"
import type { UserRole, AdminRole } from "../types/enums.js"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string
        role: UserRole
        adminRole?: AdminRole
        cityScope?: string | null
      }
    }
  }
}

/** Populates req.auth from a valid Bearer access token; 401s otherwise. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    throw ApiError.unauthorized()
  }
  try {
    const claims = verifyAccessToken(header.slice("Bearer ".length))
    req.auth = { userId: claims.sub, role: claims.role, adminRole: claims.adminRole, cityScope: claims.cityScope }
    next()
  } catch {
    throw ApiError.unauthorized("Invalid or expired session")
  }
}

/** Restricts a route to one or more of PASSENGER / DRIVER / ADMIN. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) throw ApiError.unauthorized()
    if (!roles.includes(req.auth.role)) throw ApiError.forbidden()
    next()
  }
}

/** Restricts an ADMIN route to specific admin sub-roles (RBAC scopes, docs/09 §4). */
export function requireAdminRole(...adminRoles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || req.auth.role !== "admin") throw ApiError.forbidden()
    if (req.auth.adminRole === "super_admin") return next() // super_admin bypasses scope checks
    if (!req.auth.adminRole || !adminRoles.includes(req.auth.adminRole)) throw ApiError.forbidden()
    next()
  }
}
