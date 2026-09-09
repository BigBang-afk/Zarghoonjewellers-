import type { NextFunction, Request, Response } from "express"
import type { ZodTypeAny } from "zod"
import { ApiError } from "../utils/apiError.js"

/** Validates + replaces req.body with the parsed (and coerced) result. */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      throw ApiError.badRequest("VALIDATION_ERROR", "Request body failed validation.", result.error.flatten())
    }
    req.body = result.data
    next()
  }
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      throw ApiError.badRequest("VALIDATION_ERROR", "Query parameters failed validation.", result.error.flatten())
    }
    req.query = result.data
    next()
  }
}
