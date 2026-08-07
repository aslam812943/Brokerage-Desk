-- CreateIndex
CREATE INDEX "DailyRecord_date_source_idx" ON "DailyRecord"("date", "source");

-- CreateIndex
CREATE INDEX "DebitRecord_code_date_idx" ON "DebitRecord"("code", "date");

-- CreateIndex (hand-authored: Prisma's schema DSL has no functional-index
-- syntax, so this isn't reflected in schema.prisma). Every VIEWER (dealer
-- login) request filters MasterClient.dealer/.rm case-insensitively via
-- Prisma's `mode: "insensitive"` — without this, that's a full seq scan.
CREATE INDEX "MasterClient_dealer_lower_idx" ON "MasterClient" (lower("dealer"));
CREATE INDEX "MasterClient_rm_lower_idx" ON "MasterClient" (lower("rm"));
