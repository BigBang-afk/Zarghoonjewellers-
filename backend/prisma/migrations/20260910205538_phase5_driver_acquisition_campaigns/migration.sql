-- CreateTable
CREATE TABLE "driver_acquisition_campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "cityId" TEXT,
    "vehicleTypeId" TEXT,
    "targetDriverCount" INTEGER NOT NULL,
    "incentiveAmount" REAL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "driver_acquisition_campaigns_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "driver_acquisition_campaigns_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "driver_acquisition_rewards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "transactionId" TEXT,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "driver_acquisition_rewards_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "driver_acquisition_rewards_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "driver_acquisition_campaigns" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_acquisition_campaigns_code_key" ON "driver_acquisition_campaigns"("code");

-- CreateIndex
CREATE INDEX "driver_acquisition_campaigns_status_startDate_endDate_idx" ON "driver_acquisition_campaigns"("status", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "driver_acquisition_rewards_driverId_campaignId_key" ON "driver_acquisition_rewards"("driverId", "campaignId");
