import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";
import { generateTempPassword } from "../../../../lib/generatePassword";

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
