import type { Db } from "../../src/database/db.js";
import type { ActionContext } from "../../src/types/context.js";

/** Direct-SQL fixtures for state the services under test do not create themselves. */

export const AI_CTX: ActionContext = { actor: { type: "ai", agentName: "sales_agent" }, requestId: "req-test" };
export const SYSTEM_CTX: ActionContext = { actor: { type: "system", name: "test" } };
export const staffCtx = (staffId: string): ActionContext => ({ actor: { type: "staff", staffId } });

export async function insertStaff(
  db: Db,
  overrides: Partial<{ fullName: string; role: string; isActive: boolean; isAvailable: boolean; email: string }> = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into staff (full_name, role, is_active, is_available, email) values ($1, $2, $3, $4, $5) returning id`,
    [
      overrides.fullName ?? "Ayesha Khan",
      overrides.role ?? "manager",
      overrides.isActive ?? true,
      overrides.isAvailable ?? true,
      overrides.email ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function insertProduct(
  db: Db,
  overrides: Partial<{
    sku: string;
    name: string;
    category: string | null;
    collection: string | null;
    karat: number | null;
    weightGrams: string | null;
    approvedPrice: string | null;
    stockQuantity: number | null;
    stockStatus: string | null;
    isActive: boolean;
    description: string | null;
  }> = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into products (sku, name, category, collection, karat, weight_grams, approved_price,
                           stock_quantity, stock_status, is_active, description)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      overrides.sku ?? "ZJ-NK-001",
      overrides.name ?? "Bridal Kundan Necklace",
      overrides.category === undefined ? "necklace" : overrides.category,
      overrides.collection === undefined ? "bridal" : overrides.collection,
      overrides.karat === undefined ? 22 : overrides.karat,
      overrides.weightGrams === undefined ? "45.500" : overrides.weightGrams,
      overrides.approvedPrice === undefined ? "485000.00" : overrides.approvedPrice,
      overrides.stockQuantity === undefined ? 2 : overrides.stockQuantity,
      overrides.stockStatus === undefined ? "available" : overrides.stockStatus,
      overrides.isActive ?? true,
      overrides.description ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function insertApproval(
  db: Db,
  input: { actionType: string; status: "pending" | "approved" | "rejected"; deciderId?: string },
): Promise<string> {
  const decided = input.status !== "pending";
  const rows = await db.query<{ id: string }>(
    `insert into approvals (action_type, status, requested_by_type, reason, decided_by_staff_id, decided_at)
     values ($1, $2, 'staff', 'test approval', $3, $4) returning id`,
    [input.actionType, input.status, decided ? input.deciderId : null, decided ? new Date() : null],
  );
  return rows[0]!.id;
}
