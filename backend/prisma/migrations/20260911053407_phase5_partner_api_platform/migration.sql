-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_partners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'individual',
    "commissionType" TEXT NOT NULL DEFAULT 'flat_per_referral',
    "commissionValue" REAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalEarned" REAL NOT NULL DEFAULT 0,
    "totalPaidOut" REAL NOT NULL DEFAULT 0,
    "apiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "apiKeyCreatedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "partners_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_partners" ("code", "commissionType", "commissionValue", "contactEmail", "contactName", "contactPhone", "createdAt", "createdById", "id", "isActive", "name", "totalEarned", "totalPaidOut", "type", "updatedAt") SELECT "code", "commissionType", "commissionValue", "contactEmail", "contactName", "contactPhone", "createdAt", "createdById", "id", "isActive", "name", "totalEarned", "totalPaidOut", "type", "updatedAt" FROM "partners";
DROP TABLE "partners";
ALTER TABLE "new_partners" RENAME TO "partners";
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");
CREATE UNIQUE INDEX "partners_apiKeyHash_key" ON "partners"("apiKeyHash");
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
    "partnerId" TEXT,
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
    CONSTRAINT "ride_requests_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ride_requests_scheduledRideId_fkey" FOREIGN KEY ("scheduledRideId") REFERENCES "scheduled_rides" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ride_requests" ("bookingMode", "businessAccountId", "cancellationReasonCode", "cityId", "createdAt", "departmentId", "destinationLocationId", "discountAmount", "dispatchStage", "distanceKm", "estDurationMin", "expiresAt", "id", "noMatchReason", "passengerId", "paymentMethod", "pickupLocationId", "preferFavoriteDriver", "promotionId", "proposedFare", "scheduledRideId", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId") SELECT "bookingMode", "businessAccountId", "cancellationReasonCode", "cityId", "createdAt", "departmentId", "destinationLocationId", "discountAmount", "dispatchStage", "distanceKm", "estDurationMin", "expiresAt", "id", "noMatchReason", "passengerId", "paymentMethod", "pickupLocationId", "preferFavoriteDriver", "promotionId", "proposedFare", "scheduledRideId", "searchRadiusKm", "status", "suggestedFare", "updatedAt", "vehicleTypeId", "zoneId" FROM "ride_requests";
DROP TABLE "ride_requests";
ALTER TABLE "new_ride_requests" RENAME TO "ride_requests";
CREATE UNIQUE INDEX "ride_requests_scheduledRideId_key" ON "ride_requests"("scheduledRideId");
CREATE INDEX "ride_requests_passengerId_idx" ON "ride_requests"("passengerId");
CREATE INDEX "ride_requests_cityId_status_idx" ON "ride_requests"("cityId", "status");
CREATE INDEX "ride_requests_expiresAt_idx" ON "ride_requests"("expiresAt");
CREATE INDEX "ride_requests_status_expiresAt_idx" ON "ride_requests"("status", "expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
