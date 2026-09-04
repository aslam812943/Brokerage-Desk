-- AlterTable: track when each client was first added (Clients tab "Added" column).
ALTER TABLE "MasterClient" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill pre-existing rows from their last-modified time so the "Added"
-- column is never blank for clients that predate this feature. New rows get
-- an accurate insert timestamp from here on.
UPDATE "MasterClient" SET "createdAt" = "updatedAt";

-- CreateTable: one row per bulk client upload, kept so an upload can be
-- rolled back wholesale from the "Recent uploads" list.
CREATE TABLE "ClientUpload" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileName" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ClientUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientUpload_createdAt_idx" ON "ClientUpload"("createdAt");
