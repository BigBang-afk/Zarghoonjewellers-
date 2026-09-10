-- AlterTable
ALTER TABLE "ride_requests" ADD COLUMN "cancellationReasonCode" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "cancellationReasonCode" TEXT,
    "cancellationFeeCharged" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_rides" ("acceptedAt", "agreedFare", "arrivedAt", "businessAccountId", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "destinationLocationId", "distanceKm", "driverId", "durationMin", "finalFare", "id", "passengerId", "paymentMethod", "pickupLocationId", "rideOfferId", "rideRequestId", "shareToken", "startedAt", "status", "updatedAt", "vehicleId") SELECT "acceptedAt", "agreedFare", "arrivedAt", "businessAccountId", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "destinationLocationId", "distanceKm", "driverId", "durationMin", "finalFare", "id", "passengerId", "paymentMethod", "pickupLocationId", "rideOfferId", "rideRequestId", "shareToken", "startedAt", "status", "updatedAt", "vehicleId" FROM "rides";
DROP TABLE "rides";
ALTER TABLE "new_rides" RENAME TO "rides";
CREATE UNIQUE INDEX "rides_rideRequestId_key" ON "rides"("rideRequestId");
CREATE UNIQUE INDEX "rides_rideOfferId_key" ON "rides"("rideOfferId");
CREATE UNIQUE INDEX "rides_shareToken_key" ON "rides"("shareToken");
CREATE INDEX "rides_passengerId_status_idx" ON "rides"("passengerId", "status");
CREATE INDEX "rides_driverId_status_idx" ON "rides"("driverId", "status");
CREATE INDEX "rides_status_idx" ON "rides"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
