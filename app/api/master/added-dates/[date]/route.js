import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireAdmin } from "../../../../../lib/apiAuth";
import { writeAudit } from "../../../../../lib/audit";

// DELETE — remove every client added on a given (IST) day. Used to undo an
// older bulk upload that predates per-upload tracking. Additions only: there
// is no pre-upload snapshot for clients that upload merely modified, so their
// values are left as-is.
export async function DELETE(_req, { params }) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Expected a YYYY-MM-DD date" }, { status: 400 });
  }

  const removed = await prisma.$executeRaw`
    DELETE FROM "MasterClient"
    WHERE ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date)::text = ${date}
  `;

  await writeAudit({
    userId: session.user.id,
    username: session.user.name,
    action: "DELETE_CLIENTS_BY_ADDED_DATE",
    detail: `date=${date} removed=${removed}`,
  });

  return NextResponse.json({ ok: true, removed });
}
