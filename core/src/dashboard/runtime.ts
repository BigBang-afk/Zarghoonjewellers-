import { createPgDb, type Db } from "../database/db.js";
import { describeDatabase, planMigrations } from "../database/migrator.js";
import { createZarghoonCore, type ZarghoonCore } from "../index.js";
import { createDashboardActions, type DashboardActions } from "../services/dashboard/dashboardActions.js";
import { createDashboardService, type DashboardService } from "../services/dashboard/dashboardService.js";
import { createFollowupCenter, type FollowupCenter } from "../services/dashboard/followupCenter.js";
import { createAnthropicLlmClient, loadLlmConfig } from "../agents/llm/llmClient.js";
import { createClaudeDrafter, createTemplateDrafter, type FollowupDrafter } from "../services/followupEngine/drafting.js";
import { createStaffAuthService, type StaffAuthService } from "../services/staffAuth/staffAuthService.js";
import { resolveDashboardConfig, type DashboardConfig } from "./config.js";

export class DashboardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardUnavailableError";
  }
}

export interface DashboardRuntime {
  config: DashboardConfig;
  mode: "demo" | "connected";
  /** Database label ("development" / "staging" / "production"), or "demo". */
  environmentLabel: string;
  db: Db;
  core: ZarghoonCore;
  auth: StaffAuthService;
  dashboard: DashboardService;
  actions: DashboardActions;
  followups: FollowupCenter;
  drafter: { kind: "ai" | "template"; model: string };
  close(): Promise<void>;
}

/** Claude when configured (server-side key only), else the offline templates. */
export function createDrafterFromEnv(env: NodeJS.ProcessEnv, choice: "claude" | "template"): FollowupDrafter {
  if (choice === "template") return createTemplateDrafter();
  const config = loadLlmConfig(env);
  // Short drafts: modest effort; the model id and fallbacks come from the shared config.
  const effort = (["low", "medium", "high"] as const).find((e) => e === env.FOLLOWUP_DRAFT_EFFORT) ?? "low";
  return createClaudeDrafter(createAnthropicLlmClient({ ...config, effort, maxTokens: 4000 }));
}

/**
 * Builds the dashboard backend.
 *
 * connected: verifies the database is a Zarghoon AI database carrying the
 *            expected environment label with no pending migrations; otherwise
 *            refuses to start (DashboardUnavailableError). Never falls back to demo.
 * demo:      fresh in-memory database with fake data (dynamically imported).
 */
export async function createDashboardRuntime(env: NodeJS.ProcessEnv = process.env): Promise<DashboardRuntime> {
  const config = resolveDashboardConfig(env);
  if (config.mode === "unconfigured") throw new DashboardUnavailableError(config.problem ?? "Dashboard is not configured");

  let db: Db;
  let close: () => Promise<void>;
  let environmentLabel: string;
  if (config.mode === "demo") {
    const { createInMemoryDb } = await import("../database/pgliteDb.js");
    const { seedDashboardDemo } = await import("../demo/dashboardDemo.js");
    const memory = await createInMemoryDb();
    await seedDashboardDemo(memory, { password: config.demoPassword! });
    db = memory;
    close = () => memory.close();
    environmentLabel = "demo";
  } else {
    const pg = createPgDb(config.databaseUrl!);
    try {
      const identity = await describeDatabase(pg);
      if (identity.environment !== config.expectedEnvironment) {
        throw new DashboardUnavailableError(
          `Database is labelled "${identity.environment ?? "uninitialised"}", expected "${config.expectedEnvironment}"`,
        );
      }
      const plan = await planMigrations(pg, config.expectedEnvironment!);
      if (plan.pending.length > 0) {
        throw new DashboardUnavailableError(
          `Database has ${plan.pending.length} pending migration(s); run npm run db:migrate first`,
        );
      }
    } catch (error) {
      await pg.end().catch(() => undefined);
      if (error instanceof DashboardUnavailableError) throw error;
      // Connection/driver errors may contain connection details: keep only a safe summary.
      const code = (error as { code?: string }).code;
      throw new DashboardUnavailableError(`Could not verify the database${code ? ` (${code})` : ""}`);
    }
    db = pg;
    close = () => pg.end();
    environmentLabel = config.expectedEnvironment!;
  }

  const drafter = createDrafterFromEnv(env, config.drafter);
  return {
    config,
    mode: config.mode,
    environmentLabel,
    db,
    core: createZarghoonCore({ db }),
    auth: createStaffAuthService(db),
    dashboard: createDashboardService(db, { timezone: config.timezone }),
    actions: createDashboardActions(db, { drafter }),
    followups: createFollowupCenter(db),
    drafter: { kind: drafter.kind, model: drafter.model },
    close,
  };
}
