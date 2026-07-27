-- CreateTable
CREATE TABLE "Rm" (
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rm_pkey" PRIMARY KEY ("name")
);
