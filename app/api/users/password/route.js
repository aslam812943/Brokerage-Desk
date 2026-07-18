import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";
import { requireSession } from "../../../../lib/apiAuth";
import { writeAudit } from "../../../../lib/audit";
import { isRateLimited } from "../../../../lib/rateLimit";

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

function getClientIp(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return null;
}

// Self-service password change — any signed-in user (not admin-only), since
// this is how a newly-created account replaces its temporary password on
// first login, and how anyone can rotate their own password afterwards.
export async function PUT(req) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const ip = getClientIp(req);
  if (isRateLimited(`pwchange:${session.user.name}`, ip)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "New password must be different from the current one" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "CHANGE_PASSWORD",
    detail: "self-service",
  });

  return NextResponse.json({ ok: true });
}
