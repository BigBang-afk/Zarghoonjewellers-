import type { NextFunction, Request, Response } from "express"
import { randomUUID } from "node:crypto"
import { ApiError } from "../utils/apiError.js"
import { env } from "../config/env.js"
import { logger } from "../utils/logger.js"
import { recordFailure } from "../services/observability.js"

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}`, requestId: req.id ?? randomUUID() } })
}

// A Prisma "known request error" code (P2xxx = query engine, P1xxx =
// connection) means the failure is in the database layer, not caller
// input — tracked separately from a generic 4xx/5xx API error.
function isPrismaError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string" && /^P\d{4}$/.test((err as { code: string }).code)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id ?? randomUUID()

  if (err instanceof ApiError) {
    if (err.status >= 500) recordFailure("api_errors", { requestId, path: req.path, code: err.code })
    res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, details: err.details } })
    return
  }

  if (isPrismaError(err)) recordFailure("db_errors", { requestId, path: req.path })
  else recordFailure("api_errors", { requestId, path: req.path })

  logger.error("unhandled_error", {
    requestId,
    path: req.path,
    method: req.method,
    message: err instanceof Error ? err.message : String(err),
    stack: !env.isProduction && err instanceof Error ? err.stack : undefined,
  })

  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", requestId },
  })
}
