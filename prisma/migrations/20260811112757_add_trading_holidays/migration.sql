-- CreateTable
CREATE TABLE "TradingHoliday" (
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TradingHoliday_pkey" PRIMARY KEY ("date")
);
