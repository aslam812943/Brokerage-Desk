-- Preserve every completed row and every row carrying notes as a historical
-- closure entry. Empty unchecked placeholders contain no user information.
DELETE FROM "DealerProductTask"
WHERE "done" = false AND btrim("notes") = '';

DROP INDEX "DealerProductTask_dealer_month_product_key";
DROP INDEX "DealerProductTask_month_idx";

ALTER TABLE "DealerProductTask"
    DROP COLUMN "done",
    DROP COLUMN "updatedAt",
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "DealerProductTask_dealer_month_idx"
ON "DealerProductTask"("dealer", "month");

CREATE INDEX "DealerProductTask_month_product_idx"
ON "DealerProductTask"("month", "product");
