import { PrismaClient } from "@prisma/client"
import { env } from "../config/env.js"

// Single shared Prisma client (avoids exhausting SQLite/Postgres
// connections under dev hot-reload).
export const prisma = new PrismaClient({
  log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
})
