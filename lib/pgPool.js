import { Pool } from "pg";

const globalForPool = globalThis;

// Raw pg pool for the handful of bulk-read routes (full DailyRecord/DebitRecord
// history) where Prisma's per-row model-mapping overhead dominates at scale —
// at ~180k+ rows that overhead was ~40s in production vs ~150ms for the same
// query run directly against Postgres. Everything else stays on the regular
// Prisma client; this is only for those hot paths.
export const pgPool =
  globalForPool.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pgPool;
