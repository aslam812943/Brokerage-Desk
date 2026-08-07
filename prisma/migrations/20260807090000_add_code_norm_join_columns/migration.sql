-- Hand-authored: Prisma's schema DSL has no generated-column syntax, so this
-- isn't something `prisma migrate dev` can diff from schema.prisma directly.
-- Mirrors the normCode() convention used client-side in Dashboard.jsx
-- (trim, uppercase, strip whitespace) so SQL can join DailyRecord <->
-- MasterClient by code without depending on upload-to-upload casing drift.
-- Verified against the real dev data first: no two MasterClient rows
-- normalize to the same code, so the unique constraint below is safe.

-- AlterTable
ALTER TABLE "MasterClient" ADD COLUMN "codeNorm" TEXT
  GENERATED ALWAYS AS (upper(regexp_replace(code, '\s+', '', 'g'))) STORED;

-- CreateIndex
CREATE UNIQUE INDEX "MasterClient_codeNorm_key" ON "MasterClient"("codeNorm");

-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN "codeNorm" TEXT
  GENERATED ALWAYS AS (upper(regexp_replace(code, '\s+', '', 'g'))) STORED;

-- CreateIndex
CREATE INDEX "DailyRecord_codeNorm_idx" ON "DailyRecord"("codeNorm");
