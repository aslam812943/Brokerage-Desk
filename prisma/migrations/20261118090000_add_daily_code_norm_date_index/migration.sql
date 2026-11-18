-- Supports viewer-scoped Dashboard/MIS/brokerage reads that filter by both
-- normalized client code and date. This is additive and does not alter data.
CREATE INDEX "DailyRecord_codeNorm_date_idx" ON "DailyRecord"("codeNorm", "date");
