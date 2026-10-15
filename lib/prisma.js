import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPool } from "./pgPool";

// Reuse one client and the same pg pool as bulk-read routes in each runtime.
// The adapter uses unnamed queries compatible with transaction pooling.
export const prisma = globalThis.runtimePrisma ?? new PrismaClient({
  adapter: new PrismaPg(pgPool),
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});
globalThis.runtimePrisma = prisma;
