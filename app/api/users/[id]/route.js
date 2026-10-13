import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";
import { generateTempPassword } from "../../../../lib/generatePassword";
import { z } from "zod";
import { resolveViewerScope } from "../../../../lib/viewerScope";

// Assignment changes are separate from password resets. Only admins can
// grant access, and only to a name already present in the business data.
export async function PUT(req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;
  const parsed = z.object({ viewerName: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select an existing dealer/RM." }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { username: true, role: true, viewerName: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.role !== "VIEWER") return NextResponse.json({ error: "Only viewer accounts need an assignment." }, { status: 400 });
  const scope = await resolveViewerScope(prisma, parsed.data.viewerName);
  if (!scope.matched) return NextResponse.json({ error: "That dealer/RM no longer exists. Refresh and select another." }, { status: 400 });
  await prisma.user.update({ where: { id: params.id }, data: { viewerName: scope.name } });
  await writeAudit({
    userId: session.user.id, username: session.user.name, action: "ASSIGN_VIEWER",
    detail: JSON.stringify({ targetId: params.id, username: target.username, previous: target.viewerName, viewerName: scope.name }),
  });
  return NextResponse.json({ ok: true, viewerName: scope.name });
}

// Resets a user's password to a new server-generated temporary one — for when
// someone's forgotten their password. Same shape as account creation: the
// plaintext is returned in this response only, and the account is flagged
// mustChangePassword so they set their own on next sign-in.
export async function PATCH(req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const { id } = params;
  const target = await prisma.user.findUnique({ where: { id }, select: { username: true } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
  });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "RESET_PASSWORD",
    detail: `targetId=${id} targetUsername=${target.username}`,
  });

  return NextResponse.json({ username: target.username, tempPassword });
}

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
