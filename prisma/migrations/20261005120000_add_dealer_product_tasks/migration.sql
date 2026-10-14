-- Product-specific monthly closures are stored separately from the existing
-- free-form DealerTask slots so historical task data remains untouched.
CREATE TABLE "DealerProductTask" (
    "id" TEXT NOT NULL,
    "dealer" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerProductTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DealerProductTask_month_format_check" CHECK ("month" ~ '^\d{4}-\d{2}$'),
    CONSTRAINT "DealerProductTask_product_check" CHECK ("product" IN (
        'reactivation',
        'demat',
        'mutual_fund_sip',
        'mutual_fund_lumpsum',
        'privilege_account',
        'corporate',
        'iepf',
        'ra_package'
    ))
);

CREATE UNIQUE INDEX "DealerProductTask_dealer_month_product_key"
ON "DealerProductTask"("dealer", "month", "product");

CREATE INDEX "DealerProductTask_month_idx" ON "DealerProductTask"("month");
