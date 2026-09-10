import type { NextFunction, Request, Response } from "express"
import { randomUUID } from "node:crypto"
import { logger } from "../utils/logger.js"
import { recordRequestLatency, recordFailure } from "../services/observability.js"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string
      startedAt: number
    }
  }
}

/**
 * Assigns a per-request correlation id (also echoed in error responses so
 * a user's bug report and a server log line can be matched up), times the
 * request, and writes one structured log line per response — never the
 * request body, which may carry a password or OTP code (Phase 4 §23).
 */
export function requestLogging(req: Request, res: Response, next: NextFunction) {
  req.id = randomUUID()
  req.startedAt = Date.now()
  res.setHeader("X-Request-Id", req.id)

  res.on("finish", () => {
    const durationMs = Date.now() - req.startedAt
    recordRequestLatency(durationMs)
    if (res.statusCode >= 500) recordFailure("api_errors", { requestId: req.id, path: req.path })

    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"
    logger[level]("request", {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
      userId: req.auth?.userId,
    })
  })

  next()
}
