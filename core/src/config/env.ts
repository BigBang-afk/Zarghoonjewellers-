import { z } from "zod";
import { ValidationError } from "../lib/errors.js";
import { zodIssues } from "../lib/validation.js";

/**
 * Server-side environment. Secrets come only from environment variables and
 * are never hardcoded, logged or returned to clients.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// connection string"),
  ALLOW_TEST_SKUS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Issue messages name the variable but never echo its value.
    throw new ValidationError("Invalid environment configuration", zodIssues(result.error));
  }
  if (result.data.NODE_ENV === "production" && result.data.ALLOW_TEST_SKUS) {
    throw new ValidationError("ALLOW_TEST_SKUS must not be enabled in production");
  }
  return result.data;
}
