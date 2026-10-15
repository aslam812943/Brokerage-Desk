import { Pool } from "pg";
import { databasePoolConfig } from "./databaseConfig";

const globalForPool = globalThis;

// Prisma and bulk reads share this bounded pool, including in production.
if (!globalForPool.runtimePgPool) {
  globalForPool.runtimePgPool = new Pool(databasePoolConfig(process.env.DATABASE_URL));
  globalForPool.runtimePgPool.on("error", (error) => {
    console.error("Idle database connection failed", { code: error.code });
  });
}
export const pgPool = globalForPool.runtimePgPool;
