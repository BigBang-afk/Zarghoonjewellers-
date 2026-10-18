/**
 * Creates a staff member's dashboard sign-in (or resets one).
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run staff:account -- --env staging --create --name "Full Name" --role owner --username owner
 *   ZARGHOON_CORE_DATABASE_URL=… npm run staff:account -- --env staging --staff-id <uuid> --username ali
 *   ZARGHOON_CORE_DATABASE_URL=… npm run staff:account -- --env staging --list
 *
 * The password is typed at a hidden prompt (or piped on stdin) — never passed
 * as an argument, so it does not land in shell history. The database must
 * carry the --env label (see db:migrate). Setting a password signs that staff
 * member out everywhere. Production needs --allow-production.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import { describeDatabase, ENVIRONMENTS, type DbEnvironment } from "../src/database/migrator.js";
import { toPublicError } from "../src/lib/errors.js";
import { createStaffAuthService } from "../src/services/staffAuth/staffAuthService.js";
import { STAFF_ROLES } from "../src/services/staffRules.js";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    list: { type: "boolean", default: false },
    create: { type: "boolean", default: false },
    name: { type: "string" },
    role: { type: "string" },
    email: { type: "string" },
    "staff-id": { type: "string" },
    username: { type: "string" },
    "allow-production": { type: "boolean", default: false },
  },
});

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  }
  let muted = false;
  const output = new Writable({ write: (chunk, _enc, cb) => (muted || process.stdout.write(chunk), cb()) });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(q);
      muted = true;
      rl.question("", (a) => ((muted = false), process.stdout.write("\n"), resolve(a)));
    });
  const first = await ask("New password (min 12 chars, letters and numbers): ");
  const second = await ask("Repeat password: ");
  rl.close();
  if (first !== second) throw new Error("Passwords do not match");
  return first;
}

async function main(): Promise<number> {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  const env = values.env as DbEnvironment | undefined;
  if (!url) return (console.error("Set ZARGHOON_CORE_DATABASE_URL."), 2);
  if (!env || !ENVIRONMENTS.includes(env)) return (console.error(`--env is required: one of ${ENVIRONMENTS.join(", ")}`), 2);
  if (env === "production" && !values.list && !values["allow-production"]) {
    return (console.error("Refusing to change production sign-in without --allow-production."), 2);
  }
  const db = createPgDb(url);
  try {
    const identity = await describeDatabase(db);
    if (identity.environment !== env) {
      console.error(`Stopped: database is labelled "${identity.environment ?? "not initialised"}", not "${env}".`);
      return 1;
    }
    if (values.list) {
      const rows = await db.query(
        `select s.id, s.full_name, s.role, s.is_active, c.username, c.last_login_at
           from staff s left join staff_credentials c on c.staff_id = s.id order by s.full_name`,
      );
      console.table(rows);
      return 0;
    }
    if (!values.username) return (console.error("--username is required"), 2);
    let staffId = values["staff-id"];
    if (values.create) {
      if (!values.name || !values.role || !(STAFF_ROLES as readonly string[]).includes(values.role)) {
        return (console.error(`--create needs --name and --role (${STAFF_ROLES.join(", ")})`), 2);
      }
    } else if (!staffId) {
      return (console.error("Pass --staff-id <uuid> or --create"), 2);
    }
    const password = await readPassword();
    const result = await db.transaction(async (tx) => {
      if (values.create) {
        const rows = await tx.query<{ id: string }>(
          `insert into staff (full_name, role, email, is_active, is_available) values ($1, $2, $3, true, false) returning id`,
          [values.name, values.role, values.email?.toLowerCase() ?? null],
        );
        staffId = rows[0]!.id;
      }
      return createStaffAuthService(tx).setCredential(
        { staffId: staffId!, username: values.username!, password },
        { actor: { type: "system", name: "staff_account_cli" } },
      );
    });
    console.log(`Sign-in set for ${result.staff.fullName} (${result.staff.role}) as "${result.username}". Staff id: ${result.staff.id}`);
    return 0;
  } catch (error) {
    const pub = toPublicError(error);
    console.error(pub.code === "INTERNAL_ERROR" ? `Failed: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : "unknown error"}` : JSON.stringify(pub));
    return 1;
  } finally {
    await db.end();
  }
}

main().then((code) => process.exit(code));
