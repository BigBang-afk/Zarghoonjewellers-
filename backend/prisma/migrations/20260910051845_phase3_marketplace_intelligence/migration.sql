-- AlterTable
ALTER TABLE "cities" ADD COLUMN "operatingHours" TEXT;

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN "evidence" TEXT;

-- CreateTable
CREATE TABLE "incentive_campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cityId" TEXT,
    "vehicleTypeId" TEXT,
    "targetRideCount" INTEGER NOT NULL,
    "rewardAmount" REAL NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "incentive_campaigns_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "incentive_campaigns_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "driver_incentive_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "driver_incentive_progress_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "driver_incentive_progress_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "incentive_campaigns" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incentive_rewards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "transactionId" TEXT,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incentive_rewards_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incentive_rewards_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "incentive_campaigns" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referrerUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "qualifyingAction" TEXT,
    "rewardAmountReferrer" REAL,
    "rewardAmountReferred" REAL,
    "qualifiedAt" DATETIME,
    "rewardedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "referrals_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "favorite_drivers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "favorite_drivers_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "passenger_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "favorite_drivers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_rides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passengerId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "vehicleTypeId" TEXT NOT NULL,
    "pickupLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "bookingMode" TEXT NOT NULL DEFAULT 'quick_match',
    "proposedFare" REAL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scheduled_rides_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "passenger_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "scheduled_rides_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "scheduled_rides_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "scheduled_rides_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "business_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "billingContactUserId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'wallet',
    "monthlySpendLimit" REAL,
    "ridePolicy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "business_accounts_billingContactUserId_fkey" FOREIGN KEY ("billingContactUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_accounts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "business_employees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_employees_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "details" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "risk_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rideId" TEXT,
    "discountAmount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promo_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "driver_online_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "driver_online_sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_fare_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "vehicleTypeId" TEXT NOT NULL,
    "baseFare" REAL NOT NULL,
    "perKmRate" REAL NOT NULL,
    "perMinRate" REAL NOT NULL,
    "minimumFare" REAL NOT NULL,
    "maximumFare" REAL,
    "commissionRate" REAL NOT NULL,
    "commissionFlatFee" REAL NOT NULL DEFAULT 0,
    "surgeMinMultiplier" REAL NOT NULL DEFAULT 1.0,
    "surgeMaxMultiplier" REAL NOT NULL DEFAULT 2.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fare_rules_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fare_rules_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fare_rules_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_fare_rules" ("baseFare", "cityId", "commissionRate", "createdAt", "effectiveFrom", "effectiveTo", "id", "isActive", "maximumFare", "minimumFare", "perKmRate", "perMinRate", "surgeMaxMultiplier", "surgeMinMultiplier", "updatedAt", "vehicleTypeId", "zoneId") SELECT "baseFare", "cityId", "commissionRate", "createdAt", "effectiveFrom", "effectiveTo", "id", "isActive", "maximumFare", "minimumFare", "perKmRate", "perMinRate", "surgeMaxMultiplier", "surgeMinMultiplier", "updatedAt", "vehicleTypeId", "zoneId" FROM "fare_rules";
DROP TABLE "fare_rules";
ALTER TABLE "new_fare_rules" RENAME TO "fare_rules";
CREATE INDEX "fare_rules_cityId_vehicleTypeId_zoneId_idx" ON "fare_rules"("cityId", "vehicleTypeId", "zoneId");
CREATE TABLE "new_ride_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "passengerId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "vehicleTypeId" TEXT NOT NULL,
    "pickupLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "bookingMode" TEXT NOT NULL,
    "suggestedFare" REAL NOT NULL,
    "proposedFare" REAL NOT NULL,
    "distanceKm" REAL,
    "estDurationMin" INTEGER,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "status" TEXT NOT NULL DEFAULT 'searching',
    "searchRadiusKm" REAL NOT NULL DEFAULT 5,
    "preferFavoriteDriver" BOOLEAN NOT NULL DEFAULT false,
    "promotionId" TEXT,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "businessAccountId" TEXT,
    "scheduledRideId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ride_requests_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "passenger_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_scheduledRideId_fkey" FOREIGN KEY ("scheduledRideId") REFERENCES "scheduled_rides" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ride_requests" ("bookingMode", "cityId", "createdAt", "destinationLocationId", "distanceKm", "estDurationMin", "expiresAt", "id", "passengerId", "paymentMethod", "pickupLocationId", "proposedFare", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId") SELECT "bookingMode", "cityId", "createdAt", "destinationLocationId", "distanceKm", "estDurationMin", "expiresAt", "id", "passengerId", "paymentMethod", "pickupLocationId", "proposedFare", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId" FROM "ride_requests";
DROP TABLE "ride_requests";
ALTER TABLE "new_ride_requests" RENAME TO "ride_requests";
CREATE UNIQUE INDEX "ride_requests_scheduledRideId_key" ON "ride_requests"("scheduledRideId");
CREATE INDEX "ride_requests_passengerId_idx" ON "ride_requests"("passengerId");
CREATE INDEX "ride_requests_cityId_status_idx" ON "ride_requests"("cityId", "status");
CREATE INDEX "ride_requests_expiresAt_idx" ON "ride_requests"("expiresAt");
CREATE TABLE "new_rides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rideRequestId" TEXT NOT NULL,
    "rideOfferId" TEXT,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "pickupLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "agreedFare" REAL NOT NULL,
    "finalFare" REAL,
    "distanceKm" REAL,
    "durationMin" INTEGER,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "status" TEXT NOT NULL DEFAULT 'driver_selected',
    "businessAccountId" TEXT,
    "shareToken" TEXT,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rides_rideRequestId_fkey" FOREIGN KEY ("rideRequestId") REFERENCES "ride_requests" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_rideOfferId_fkey" FOREIGN KEY ("rideOfferId") REFERENCES "ride_offers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "rides_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "passenger_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "rides_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_rides" ("acceptedAt", "agreedFare", "arrivedAt", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "destinationLocationId", "distanceKm", "driverId", "durationMin", "finalFare", "id", "passengerId", "paymentMethod", "pickupLocationId", "rideOfferId", "rideRequestId", "shareToken", "startedAt", "status", "updatedAt", "vehicleId") SELECT "acceptedAt", "agreedFare", "arrivedAt", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "destinationLocationId", "distanceKm", "driverId", "durationMin", "finalFare", "id", "passengerId", "paymentMethod", "pickupLocationId", "rideOfferId", "rideRequestId", "shareToken", "startedAt", "status", "updatedAt", "vehicleId" FROM "rides";
DROP TABLE "rides";
ALTER TABLE "new_rides" RENAME TO "rides";
CREATE UNIQUE INDEX "rides_rideRequestId_key" ON "rides"("rideRequestId");
CREATE UNIQUE INDEX "rides_rideOfferId_key" ON "rides"("rideOfferId");
CREATE UNIQUE INDEX "rides_shareToken_key" ON "rides"("shareToken");
CREATE INDEX "rides_passengerId_status_idx" ON "rides"("passengerId", "status");
CREATE INDEX "rides_driverId_status_idx" ON "rides"("driverId", "status");
CREATE INDEX "rides_status_idx" ON "rides"("status");
CREATE TABLE "new_support_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "rideId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'technical',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assignedAdminId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_support_tickets" ("assignedAdminId", "createdAt", "description", "id", "priority", "resolvedAt", "rideId", "status", "subject", "updatedAt", "userId") SELECT "assignedAdminId", "createdAt", "description", "id", "priority", "resolvedAt", "rideId", "status", "subject", "updatedAt", "userId" FROM "support_tickets";
DROP TABLE "support_tickets";
ALTER TABLE "new_support_tickets" RENAME TO "support_tickets";
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "incentive_campaigns_status_startDate_endDate_idx" ON "incentive_campaigns"("status", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "driver_incentive_progress_driverId_campaignId_key" ON "driver_incentive_progress"("driverId", "campaignId");

-- CreateIndex
CREATE INDEX "incentive_rewards_driverId_idx" ON "incentive_rewards"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_userId_key" ON "referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredUserId_key" ON "referrals"("referredUserId");

-- CreateIndex
CREATE INDEX "referrals_referrerUserId_status_idx" ON "referrals"("referrerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_drivers_passengerId_driverId_key" ON "favorite_drivers"("passengerId", "driverId");

-- CreateIndex
CREATE INDEX "scheduled_rides_status_scheduledFor_idx" ON "scheduled_rides"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "business_employees_businessAccountId_userId_key" ON "business_employees"("businessAccountId", "userId");

-- CreateIndex
CREATE INDEX "risk_events_userId_createdAt_idx" ON "risk_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "risk_events_severity_reviewedAt_idx" ON "risk_events"("severity", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "risk_scores_userId_key" ON "risk_scores"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_promotionId_userId_key" ON "promo_redemptions"("promotionId", "userId");

-- CreateIndex
CREATE INDEX "driver_online_sessions_driverId_startedAt_idx" ON "driver_online_sessions"("driverId", "startedAt");
