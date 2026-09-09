import "dotenv/config"

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value.toLowerCase() === "true"
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),

  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",

  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),

  mockOtp: bool("MOCK_OTP", true),
  mockPayments: bool("MOCK_PAYMENTS", true),
  mockNotifications: bool("MOCK_NOTIFICATIONS", true),
}

if (env.isProduction) {
  if (env.jwtAccessSecret.includes("dev-") || env.jwtRefreshSecret.includes("dev-")) {
    throw new Error("Refusing to start in production with default dev JWT secrets. Set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET.")
  }
}
