import type { NextFunction, Request, Response } from "express"
import { randomUUID } from "node:crypto"
import { ApiError } from "../utils/apiError.js"
import { env } from "../config/env.js"

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}`, requestId: randomUUID() } })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const requestId = randomUUID()

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, details: err.details } })
    return
  }

  if (!env.isProduction) {
    // eslint-disable-next-line no-console
    console.error(`[${requestId}]`, err)
  } else {
    // eslint-disable-next-line no-console
    console.error(`[${requestId}] Unhandled error:`, err instanceof Error ? err.message : err)
  }

  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", requestId },
  })
}
