-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_scheduled_rides" (
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
    CONSTRAINT "scheduled_rides_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "scheduled_rides_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "scheduled_rides_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_scheduled_rides" ("bookingMode", "cityId", "createdAt", "destinationLocationId", "id", "passengerId", "pickupLocationId", "proposedFare", "scheduledFor", "status", "updatedAt", "vehicleTypeId", "zoneId") SELECT "bookingMode", "cityId", "createdAt", "destinationLocationId", "id", "passengerId", "pickupLocationId", "proposedFare", "scheduledFor", "status", "updatedAt", "vehicleTypeId", "zoneId" FROM "scheduled_rides";
DROP TABLE "scheduled_rides";
ALTER TABLE "new_scheduled_rides" RENAME TO "scheduled_rides";
CREATE INDEX "scheduled_rides_status_scheduledFor_idx" ON "scheduled_rides"("status", "scheduledFor");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
