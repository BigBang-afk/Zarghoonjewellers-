-- AlterTable
ALTER TABLE "cities" ADD COLUMN "driverRequirements" TEXT;
ALTER TABLE "cities" ADD COLUMN "paymentMethods" TEXT;

-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN "dailyEarningsTargetRs" REAL;
ALTER TABLE "driver_profiles" ADD COLUMN "destinationPreference" TEXT;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN "campaignType" TEXT;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN "attachments" TEXT;
ALTER TABLE "support_tickets" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "support_tickets" ADD COLUMN "internalNotes" TEXT;

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "payout_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "content_items_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "content_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "invitation_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "cityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_safety_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rideId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "details" TEXT,
    "lat" REAL,
    "lng" REAL,
    "assignedAdminId" TEXT,
    "notes" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "safety_events_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "safety_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "safety_events_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_safety_events" ("createdAt", "details", "id", "lat", "lng", "resolvedAt", "rideId", "severity", "type", "userId") SELECT "createdAt", "details", "id", "lat", "lng", "resolvedAt", "rideId", "severity", "type", "userId" FROM "safety_events";
DROP TABLE "safety_events";
ALTER TABLE "new_safety_events" RENAME TO "safety_events";
CREATE INDEX "safety_events_severity_resolvedAt_idx" ON "safety_events"("severity", "resolvedAt");
CREATE INDEX "safety_events_rideId_idx" ON "safety_events"("rideId");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "primaryCityId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "phoneVerifiedAt" DATETIME,
    "acquisitionSource" TEXT,
    "acquisitionCampaign" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT true,
    "deletionRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "users_primaryCityId_fkey" FOREIGN KEY ("primaryCityId") REFERENCES "cities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("createdAt", "deletedAt", "email", "fullName", "id", "locale", "passwordHash", "phone", "phoneVerifiedAt", "photoUrl", "primaryCityId", "role", "status", "updatedAt") SELECT "createdAt", "deletedAt", "email", "fullName", "id", "locale", "passwordHash", "phone", "phoneVerifiedAt", "photoUrl", "primaryCityId", "role", "status", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE TABLE "new_wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "pendingBalance" REAL NOT NULL DEFAULT 0,
    "paidBalance" REAL NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_wallets" ("balance", "createdAt", "currencyCode", "id", "updatedAt", "userId") SELECT "balance", "createdAt", "currencyCode", "id", "updatedAt", "userId" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "payout_requests_driverId_status_idx" ON "payout_requests"("driverId", "status");

-- CreateIndex
CREATE INDEX "payout_requests_status_createdAt_idx" ON "payout_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "content_items_type_isActive_sortOrder_idx" ON "content_items"("type", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_locale_key" ON "notification_templates"("key", "locale");

-- CreateIndex
CREATE INDEX "waitlist_entries_cityName_userType_idx" ON "waitlist_entries"("cityName", "userType");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_codes_code_key" ON "invitation_codes"("code");
