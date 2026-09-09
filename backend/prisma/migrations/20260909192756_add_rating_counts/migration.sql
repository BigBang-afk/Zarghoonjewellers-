-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "driver_profiles_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_driver_profiles" ("acceptanceRate", "availabilityStatus", "cancellationRate", "cancelledRides", "cityId", "completedRides", "createdAt", "deletedAt", "id", "lastLat", "lastLng", "lastLocationAt", "licenseExpiry", "licenseNumber", "ratingAvg", "updatedAt", "userId", "verificationStatus") SELECT "acceptanceRate", "availabilityStatus", "cancellationRate", "cancelledRides", "cityId", "completedRides", "createdAt", "deletedAt", "id", "lastLat", "lastLng", "lastLocationAt", "licenseExpiry", "licenseNumber", "ratingAvg", "updatedAt", "userId", "verificationStatus" FROM "driver_profiles";
DROP TABLE "driver_profiles";
ALTER TABLE "new_driver_profiles" RENAME TO "driver_profiles";
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");
CREATE INDEX "driver_profiles_cityId_availabilityStatus_idx" ON "driver_profiles"("cityId", "availabilityStatus");
CREATE INDEX "driver_profiles_verificationStatus_idx" ON "driver_profiles"("verificationStatus");
CREATE TABLE "new_passenger_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "completedRides" INTEGER NOT NULL DEFAULT 0,
    "cancelledRides" INTEGER NOT NULL DEFAULT 0,
    "ratingAvg" REAL NOT NULL DEFAULT 5.0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "passenger_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_passenger_profiles" ("cancelledRides", "completedRides", "createdAt", "id", "ratingAvg", "updatedAt", "userId") SELECT "cancelledRides", "completedRides", "createdAt", "id", "ratingAvg", "updatedAt", "userId" FROM "passenger_profiles";
DROP TABLE "passenger_profiles";
ALTER TABLE "new_passenger_profiles" RENAME TO "passenger_profiles";
CREATE UNIQUE INDEX "passenger_profiles_userId_key" ON "passenger_profiles"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
