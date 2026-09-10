-- CreateIndex
CREATE INDEX "counter_offers_status_expiresAt_idx" ON "counter_offers"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ride_offers_status_expiresAt_idx" ON "ride_offers"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ride_requests_status_expiresAt_idx" ON "ride_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "users_deletionRequestedAt_idx" ON "users"("deletionRequestedAt");

-- CreateIndex
CREATE INDEX "webhook_events_status_createdAt_idx" ON "webhook_events"("status", "createdAt");
