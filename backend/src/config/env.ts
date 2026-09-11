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

  // The `cors` package only treats a *bare* "*" string as "allow any
  // origin" — passed inside an array (["*"]) it instead matches origins
  // literally against the string "*", which no real browser/WebView ever
  // sends, so every cross-origin request gets silently rejected. Special-
  // cased here so CORS_ORIGIN=* actually behaves like a wildcard.
  corsOrigin:
    process.env.CORS_ORIGIN?.trim() === "*"
      ? ("*" as const)
      : (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),

  mockOtp: bool("MOCK_OTP", true),
  mockPayments: bool("MOCK_PAYMENTS", true),
  mockNotifications: bool("MOCK_NOTIFICATIONS", true),

  // Payment webhooks (Phase 4 §4) — a dev-only shared-secret HMAC scheme
  // for the mock card provider's verifyWebhookSignature. A real provider
  // (Stripe etc.) has its own signature scheme and its own secret.
  paymentsWebhookSecret: process.env.PAYMENTS_PROVIDER_WEBHOOK_SECRET ?? "dev-webhook-secret-change-me",
}

if (env.isProduction) {
  if (env.jwtAccessSecret.includes("dev-") || env.jwtRefreshSecret.includes("dev-")) {
    throw new Error("Refusing to start in production with default dev JWT secrets. Set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET.")
  }
  if (env.paymentsWebhookSecret.includes("dev-")) {
    // Left unguarded, anyone reading this public source could compute a
    // valid webhook signature against the known default and mark
    // arbitrary payments/payouts as completed.
    throw new Error("Refusing to start in production with the default dev webhook secret. Set PAYMENTS_PROVIDER_WEBHOOK_SECRET.")
  }
}
