import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireAdmin } from "../../../lib/apiAuth";
import { writeAudit } from "../../../lib/audit";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await prisma.user.findMany({
    select: { id: true, username: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(rows);
}

// Bulk-delete all users except the caller.
// Requires { confirm: "DELETE_ALL_USERS" } in the request body as an extra
// server-side safeguard (the UI DangerZone already asks for typed confirmation).
export async function DELETE(req) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== "DELETE_ALL_USERS") {
    return NextResponse.json({ error: "Missing confirmation" }, { status: 400 });
  }

  const result = await prisma.user.deleteMany({
    where: { id: { not: session.user.id } },
  });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "BULK_DELETE_USERS",
    detail: `deleted=${result.count}`,
  });

  return NextResponse.json({ ok: true, count: result.count });
}
