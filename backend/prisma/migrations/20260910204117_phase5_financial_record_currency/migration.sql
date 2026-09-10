/*
  Warnings:

  - Added the required column `currencyCode` to the `commissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currencyCode` to the `payout_requests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currencyCode` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_commissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_commissions" ("amount", "createdAt", "id", "paymentId", "rate", "currencyCode")
  SELECT c."amount", c."createdAt", c."id", c."paymentId", c."rate", p."currencyCode"
  FROM "commissions" c JOIN "payments" p ON p."id" = c."paymentId";
DROP TABLE "commissions";
ALTER TABLE "new_commissions" RENAME TO "commissions";
CREATE UNIQUE INDEX "commissions_paymentId_key" ON "commissions"("paymentId");
CREATE TABLE "new_payout_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "payout_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_payout_requests" ("amount", "createdAt", "driverId", "id", "method", "notes", "processedAt", "reference", "status", "currencyCode")
  SELECT pr."amount", pr."createdAt", pr."driverId", pr."id", pr."method", pr."notes", pr."processedAt", pr."reference", pr."status", ct."currencyCode"
  FROM "payout_requests" pr
  JOIN "driver_profiles" dp ON dp."id" = pr."driverId"
  JOIN "cities" ct ON ct."id" = dp."cityId";
DROP TABLE "payout_requests";
ALTER TABLE "new_payout_requests" RENAME TO "payout_requests";
CREATE INDEX "payout_requests_driverId_status_idx" ON "payout_requests"("driverId", "status");
CREATE INDEX "payout_requests_status_createdAt_idx" ON "payout_requests"("status", "createdAt");
CREATE TABLE "new_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("amount", "balanceAfter", "createdAt", "description", "id", "paymentId", "type", "walletId", "currencyCode")
  SELECT t."amount", t."balanceAfter", t."createdAt", t."description", t."id", t."paymentId", t."type", t."walletId", w."currencyCode"
  FROM "transactions" t JOIN "wallets" w ON w."id" = t."walletId";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
CREATE INDEX "transactions_walletId_createdAt_idx" ON "transactions"("walletId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
