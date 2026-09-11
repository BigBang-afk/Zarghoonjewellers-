-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variants" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "targetRole" TEXT NOT NULL DEFAULT 'all',
    "cityIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "experiment_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "experiment_assignments_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "experiment_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "experiments_key_key" ON "experiments"("key");

-- CreateIndex
CREATE INDEX "experiment_assignments_experimentId_variantKey_idx" ON "experiment_assignments"("experimentId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignments_experimentId_userId_key" ON "experiment_assignments"("experimentId", "userId");
