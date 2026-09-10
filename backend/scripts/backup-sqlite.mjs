#!/usr/bin/env node
// Phase 4 §34 — SQLite backup for the pilot deployment. Uses SQLite's
// own `VACUUM INTO` (not a raw file copy), which produces a single
// consistent, atomic snapshot even while the app is running — no need
// to stop the server or worry about a write landing mid-copy.
//
// This is the pilot-scale tool. Once production moves to Postgres
// (docs/15-production-configuration.md §2), replace this with the
// managed database's own backup mechanism (e.g. RDS automated
// snapshots, or `pg_dump` on a schedule) — see docs/16-backup-recovery.md.
//
// Usage: node scripts/backup-sqlite.mjs [--retain=N]
// Reads DATABASE_URL the same way the app does (only `file:` URLs are
// supported here — this script is SQLite-only by design).

import { PrismaClient } from "@prisma/client"
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const backupDir = path.resolve(here, "../backups")

function parseRetainArg() {
  const arg = process.argv.find((a) => a.startsWith("--retain="))
  return arg ? Number(arg.split("=")[1]) : 14
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db"
  if (!databaseUrl.startsWith("file:")) {
    console.error(`This script only backs up SQLite ("file:") datasources. DATABASE_URL is "${databaseUrl}".`)
    console.error("For Postgres, use the managed database's own backup mechanism instead — see docs/16-backup-recovery.md.")
    process.exit(1)
  }

  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const destPath = path.join(backupDir, `rivo-${timestamp}.db`)

  const prisma = new PrismaClient()
  try {
    // VACUUM INTO writes a complete, internally-consistent copy in one
    // statement — safe to run against a live database.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${destPath}'`)
  } finally {
    await prisma.$disconnect()
  }

  const sizeKb = Math.round(statSync(destPath).size / 1024)
  console.log(`Backup written: ${destPath} (${sizeKb} KB)`)

  const retain = parseRetainArg()
  const backups = readdirSync(backupDir)
    .filter((f) => f.startsWith("rivo-") && f.endsWith(".db"))
    .map((f) => ({ file: f, mtime: statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  const stale = backups.slice(retain)
  for (const b of stale) {
    unlinkSync(path.join(backupDir, b.file))
    console.log(`Pruned old backup: ${b.file}`)
  }
  console.log(`Retaining ${Math.min(backups.length, retain)} of ${backups.length} backups (--retain=${retain}).`)
}

main().catch((err) => {
  console.error("Backup failed:", err)
  process.exit(1)
})
