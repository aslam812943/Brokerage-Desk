-- CreateTable
CREATE TABLE "DealerTask" (
    "id" TEXT NOT NULL,
    "dealer" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DealerTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealerTask_dealer_month_idx" ON "DealerTask"("dealer", "month");

-- CreateIndex
CREATE UNIQUE INDEX "DealerTask_dealer_month_slot_key" ON "DealerTask"("dealer", "month", "slot");
