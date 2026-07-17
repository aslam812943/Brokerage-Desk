-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterClient" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "rm" TEXT NOT NULL DEFAULT '',
    "dealer" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterClient_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Dealer" (
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "DailyRecord" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "netBrok" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "DailyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitRecord" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "DebitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Targets" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "monthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealerMonthly" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "DailyRecord_date_idx" ON "DailyRecord"("date");

-- CreateIndex
CREATE INDEX "DailyRecord_code_idx" ON "DailyRecord"("code");

-- CreateIndex
CREATE INDEX "DebitRecord_date_idx" ON "DebitRecord"("date");

-- CreateIndex
CREATE INDEX "DebitRecord_code_idx" ON "DebitRecord"("code");
