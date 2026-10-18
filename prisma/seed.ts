import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { isBlockedPassword } from "../src/lib/security/insecureCredentials";

/**
 * Seeds the website admin account — only from explicit environment variables:
 *   ADMIN_USERNAME, ADMIN_PASSWORD (at least 12 characters, not a published password)
 *
 * No default credentials exist and no password is ever printed. This seed runs
 * during deployment builds, so it never modifies an existing account: if an
 * account still uses a published password it only warns (sign-in with such a
 * password is already refused by the app). Rotate it with ADMIN_PASSWORD and
 * ADMIN_ROTATE_PASSWORD=true.
 */

const prisma = new PrismaClient();

function strongEnough(password: string): string | null {
  if (password.length < 12) return "ADMIN_PASSWORD must be at least 12 characters";
  if (isBlockedPassword(password)) return "ADMIN_PASSWORD is a published password and cannot be used";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "ADMIN_PASSWORD must contain letters and numbers";
  return null;
}

/** Stored bcrypt hashes can't be checked against the blocked list (only its SHA-256 is kept), so report the policy. */
async function reportAdmins() {
  const count = await prisma.user.count({ where: { role: "ADMIN" } });
  if (count > 0) {
    console.log(`Admin accounts present: ${count}. Any account still using a published password is refused at sign-in until rotated.`);
  }
}

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.log("Admin seed skipped: set ADMIN_USERNAME and ADMIN_PASSWORD to create an admin account.");
    await reportAdmins();
    return;
  }
  const problem = strongEnough(password);
  if (problem) throw new Error(problem);

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    if (process.env.ADMIN_ROTATE_PASSWORD === "true" && existing.role === "ADMIN") {
      await prisma.user.update({ where: { username }, data: { password: await bcrypt.hash(password, 12) } });
      console.log(`Admin password rotated for "${username}".`);
    } else {
      console.log(`Admin "${username}" already exists; leaving it unchanged (set ADMIN_ROTATE_PASSWORD=true to rotate).`);
    }
    return;
  }

  await prisma.user.create({
    data: {
      fullName: "Administrator",
      username,
      password: await bcrypt.hash(password, 12),
      dob: new Date("1990-01-01"),
      mobile: "0000000000",
      role: "ADMIN",
    },
  });
  console.log(`Admin account "${username}" created.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
