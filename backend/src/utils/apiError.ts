/**
 * Stable, machine-readable error type matching the contract in
 * docs/09-api-architecture.md § Error contract.
 */
export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details)
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "UNAUTHENTICATED", message)
  }
  static forbidden(message = "You do not have permission to do this") {
    return new ApiError(403, "FORBIDDEN", message)
  }
  static notFound(message = "Resource not found") {
    return new ApiError(404, "NOT_FOUND", message)
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message)
  }
  static unprocessable(code: string, message: string) {
    return new ApiError(422, code, message)
  }
  static rateLimited(message = "Too many requests") {
    return new ApiError(429, "RATE_LIMITED", message)
  }
}
