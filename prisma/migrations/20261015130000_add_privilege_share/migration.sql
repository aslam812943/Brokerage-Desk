ALTER TABLE "Targets" ADD COLUMN "privilegeSharePct" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "Targets" ADD CONSTRAINT "Targets_privilegeSharePct_range"
  CHECK ("privilegeSharePct" >= 0 AND "privilegeSharePct" <= 100);
