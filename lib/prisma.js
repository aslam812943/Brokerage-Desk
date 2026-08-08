import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis;

// The driver adapter talks to Postgres via the plain `pg` driver instead of
// Prisma's Rust query engine binary — on Vercel that binary is what most of
// a cold start's latency goes to spinning up, so this is the one lever that
// actually shrinks cold-start time from application code (~800ms -> under
// 100ms per Prisma's own serverless benchmarks), rather than just avoiding
// repeat work once a function is already warm.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
