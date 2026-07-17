import { prisma } from "./prisma";

/**
 * Write an immutable audit entry. Never throws — audit failure must not
 * block the main operation, but is logged to stderr for alerting.
 *
 * @param {{ userId: string, username: string, action: string, detail?: string }} entry
 */
export async function writeAudit({ userId, username, action, detail = "" }) {
  try {
    await prisma.auditLog.create({ data: { userId, username, action, detail } });
  } catch (e) {
    console.error("[audit] Failed to write audit log:", e);
  }
}
