-- CreateTable
CREATE TABLE "business_departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlySpendLimit" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "business_departments_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "business_invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessAccountId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "rideCount" INTEGER NOT NULL,
    "totalAmount" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_invoices_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fleet_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "commissionSharePct" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fleet_accounts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fleet_accounts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_business_employees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_employees_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "business_departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_business_employees" ("businessAccountId", "createdAt", "id", "role", "userId") SELECT "businessAccountId", "createdAt", "id", "role", "userId" FROM "business_employees";
DROP TABLE "business_employees";
ALTER TABLE "new_business_employees" RENAME TO "business_employees";
CREATE UNIQUE INDEX "business_employees_businessAccountId_userId_key" ON "business_employees"("businessAccountId", "userId");
CREATE TABLE "new_driver_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "availabilityStatus" TEXT NOT NULL DEFAULT 'offline',
    "licenseNumber" TEXT,
    "licenseExpiry" DATETIME,
    "completedRides" INTEGER NOT NULL DEFAULT 0,
    "cancelledRides" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" REAL NOT NULL DEFAULT 5.0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "acceptanceRate" REAL NOT NULL DEFAULT 100.0,
    "cancellationRate" REAL NOT NULL DEFAULT 0.0,
    "lastLat" REAL,
    "lastLng" REAL,
    "lastLocationAt" DATETIME,
    "lastLocationAccuracyM" REAL,
    "destinationPreference" TEXT,
    "dailyEarningsTargetRs" REAL,
    "fleetAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "driver_profiles_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "driver_profiles_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_driver_profiles" ("acceptanceRate", "availabilityStatus", "cancellationRate", "cancelledRides", "cityId", "completedRides", "createdAt", "dailyEarningsTargetRs", "deletedAt", "destinationPreference", "id", "lastLat", "lastLng", "lastLocationAccuracyM", "lastLocationAt", "licenseExpiry", "licenseNumber", "ratingAvg", "ratingCount", "updatedAt", "userId", "verificationStatus") SELECT "acceptanceRate", "availabilityStatus", "cancellationRate", "cancelledRides", "cityId", "completedRides", "createdAt", "dailyEarningsTargetRs", "deletedAt", "destinationPreference", "id", "lastLat", "lastLng", "lastLocationAccuracyM", "lastLocationAt", "licenseExpiry", "licenseNumber", "ratingAvg", "ratingCount", "updatedAt", "userId", "verificationStatus" FROM "driver_profiles";
DROP TABLE "driver_profiles";
ALTER TABLE "new_driver_profiles" RENAME TO "driver_profiles";
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");
CREATE INDEX "driver_profiles_cityId_availabilityStatus_idx" ON "driver_profiles"("cityId", "availabilityStatus");
CREATE INDEX "driver_profiles_verificationStatus_idx" ON "driver_profiles"("verificationStatus");
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
    "departmentId" TEXT,
    "scheduledRideId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dispatchStage" TEXT,
    "noMatchReason" TEXT,
    "cancellationReasonCode" TEXT,
    CONSTRAINT "ride_requests_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "passenger_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "business_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "business_departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_scheduledRideId_fkey" FOREIGN KEY ("scheduledRideId") REFERENCES "scheduled_rides" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ride_requests" ("bookingMode", "businessAccountId", "cancellationReasonCode", "cityId", "createdAt", "destinationLocationId", "discountAmount", "dispatchStage", "distanceKm", "estDurationMin", "expiresAt", "id", "noMatchReason", "passengerId", "paymentMethod", "pickupLocationId", "preferFavoriteDriver", "promotionId", "proposedFare", "scheduledRideId", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId") SELECT "bookingMode", "businessAccountId", "cancellationReasonCode", "cityId", "createdAt", "destinationLocationId", "discountAmount", "dispatchStage", "distanceKm", "estDurationMin", "expiresAt", "id", "noMatchReason", "passengerId", "paymentMethod", "pickupLocationId", "preferFavoriteDriver", "promotionId", "proposedFare", "scheduledRideId", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId" FROM "ride_requests";
DROP TABLE "ride_requests";
ALTER TABLE "new_ride_requests" RENAME TO "ride_requests";
CREATE UNIQUE INDEX "ride_requests_scheduledRideId_key" ON "ride_requests"("scheduledRideId");
CREATE INDEX "ride_requests_passengerId_idx" ON "ride_requests"("passengerId");
CREATE INDEX "ride_requests_cityId_status_idx" ON "ride_requests"("cityId", "status");
CREATE INDEX "ride_requests_expiresAt_idx" ON "ride_requests"("expiresAt");
CREATE INDEX "ride_requests_status_expiresAt_idx" ON "ride_requests"("status", "expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "business_departments_businessAccountId_name_key" ON "business_departments"("businessAccountId", "name");

-- CreateIndex
CREATE INDEX "business_invoices_businessAccountId_status_idx" ON "business_invoices"("businessAccountId", "status");
