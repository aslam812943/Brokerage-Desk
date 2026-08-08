-- The DROP DEFAULT lines Prisma auto-generated for DailyRecord.codeNorm /
-- MasterClient.codeNorm are removed here — those are hand-authored
-- GENERATED ALWAYS AS columns (see the 20260807090000 migration) that
-- Prisma's schema DSL can't represent, so every `migrate dev` run
-- perceives false drift on them. Only the real change (new Targets
-- columns) is kept.

-- AlterTable
ALTER TABLE "Targets" ADD COLUMN     "dealerSalary" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "incentiveMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 10;
