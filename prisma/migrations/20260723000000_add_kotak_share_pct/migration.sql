-- AlterTable
ALTER TABLE "Targets" ADD COLUMN     "kotakSharePct" DOUBLE PRECISION NOT NULL DEFAULT 85;

-- Data migration: every existing Kotak-sourced DailyRecord was saved with the
-- old hardcoded 85% share already applied (netBrok = raw * 0.85). From this
-- release on, netBrok always stores the raw uploaded figure and the share is
-- applied at read time using Targets.kotakSharePct, so past records need to
-- be restored to raw here or they'd be double-discounted going forward.
UPDATE "DailyRecord" SET "netBrok" = "netBrok" / 0.85 WHERE "source" = 'KOTAK';
