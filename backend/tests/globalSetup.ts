import { execSync } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const testDbPath = path.resolve(here, "../prisma/test.db")

export default async function globalSetup() {
  if (existsSync(testDbPath)) unlinkSync(testDbPath)

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(here, ".."),
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  })

  return async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath)
    const journal = `${testDbPath}-journal`
    if (existsSync(journal)) unlinkSync(journal)
  }
}
