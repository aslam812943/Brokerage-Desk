import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis;

// The driver adapter talks to Postgres via the plain `pg` driver instead of
// Prisma's Rust query engine binary — on Vercel that binary is what most of
// a cold start's latency goes to spinning up, so this is the one lever that
// actually shrinks cold-start time from application code (~800ms -> under
// 100ms per Prisma's own serverless benchmarks), rather than just avoiding
// repeat work once a function is already warm.
//
// pg.Pool defaults to 10 connections, which is disastrous on serverless: a
// handful of concurrent Vercel invocations, each opening its own pool of up
// to 10, blows through a shared Postgres/pooler connection ceiling almost
// immediately (this is what caused the "max clients reached in session
// mode" errors — Supabase's session-mode pooler here caps out at 15 total).
// `max: 1` avoided that, but it also silently serializes any route that
// fires several queries concurrently via Promise.all — e.g.
// /api/dashboard/summary's 4 queries ran one-at-a-time on the single
// connection, turning a ~1.5s request into ~5.8s. `max: 3` covers that
// route's real concurrency need while keeping worst-case usage (a handful
// of low-traffic internal users) safely under the pooler's cap.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 3 });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
