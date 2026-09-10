-- CreateTable
CREATE TABLE "lost_item_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "itemCategory" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "foundAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "lost_item_reports_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lost_item_reports_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lost_item_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lost_item_reports_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "lost_item_reports_ticketId_key" ON "lost_item_reports"("ticketId");

-- CreateIndex
CREATE INDEX "lost_item_reports_driverUserId_status_idx" ON "lost_item_reports"("driverUserId", "status");

-- CreateIndex
CREATE INDEX "lost_item_reports_reporterUserId_idx" ON "lost_item_reports"("reporterUserId");
