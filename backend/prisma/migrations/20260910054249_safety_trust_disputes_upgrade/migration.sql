-- AlterTable
ALTER TABLE "disputes" ADD COLUMN "decision" TEXT;

-- AlterTable
ALTER TABLE "driver_documents" ADD COLUMN "expiryWarnedAt" DATETIME;

-- AlterTable
ALTER TABLE "vehicle_documents" ADD COLUMN "expiryWarnedAt" DATETIME;

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_blocks_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_blocks_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "user_blocks_blockedUserId_idx" ON "user_blocks"("blockedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blockerUserId_blockedUserId_key" ON "user_blocks"("blockerUserId", "blockedUserId");
