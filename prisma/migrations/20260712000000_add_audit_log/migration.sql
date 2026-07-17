-- CreateTable
CREATE TABLE "AuditLog" (
    "id"        TEXT         NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId"    TEXT         NOT NULL,
    "username"  TEXT         NOT NULL,
    "action"    TEXT         NOT NULL,
    "detail"    TEXT         NOT NULL DEFAULT '',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
