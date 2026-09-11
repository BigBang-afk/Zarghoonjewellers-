-- CreateTable
CREATE TABLE "system_incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "affectedArea" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "system_incidents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_incident_updates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "postedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "system_incidents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "system_incident_updates_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "system_incidents_status_idx" ON "system_incidents"("status");

-- CreateIndex
CREATE INDEX "system_incident_updates_incidentId_createdAt_idx" ON "system_incident_updates"("incidentId", "createdAt");
