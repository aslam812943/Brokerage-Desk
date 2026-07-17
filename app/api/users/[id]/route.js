import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";

// Delete a single user by ID. An admin cannot delete themselves.
export async function DELETE(req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const { id } = params;
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { username: true } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "DELETE_USER",
    detail: `targetId=${id} targetUsername=${target.username}`,
  });

  return NextResponse.json({ ok: true });
}
