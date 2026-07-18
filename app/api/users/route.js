import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../../lib/prisma";
import { requireAdmin } from "../../../lib/apiAuth";
import { writeAudit } from "../../../lib/audit";
import { generateTempPassword } from "../../../lib/generatePassword";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await prisma.user.findMany({
    select: { id: true, username: true, role: true, mustChangePassword: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(rows);
}

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, dot, underscore, hyphen"),
  role: z.enum(["ADMIN", "VIEWER"]).default("VIEWER"),
});

// Creates a user with a server-generated temporary password. The plaintext
// password is returned in this response only — it is never stored or
// retrievable again, so the admin must hand it to the user now. The account
// is flagged mustChangePassword so the user is forced to set their own
// password the first time they sign in.
export async function POST(req) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const username = parsed.data.username.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const created = await prisma.user.create({
    data: { username, passwordHash, role: parsed.data.role, mustChangePassword: true },
    select: { id: true, username: true, role: true, createdAt: true },
  });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "CREATE_USER",
    detail: `targetUsername=${username} role=${parsed.data.role}`,
  });

  return NextResponse.json({ ...created, tempPassword }, { status: 201 });
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
